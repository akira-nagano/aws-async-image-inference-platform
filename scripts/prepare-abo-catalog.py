from __future__ import annotations

import argparse
import csv
import gzip
import json
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ABO_BASE_URL = "https://amazon-berkeley-objects.s3.amazonaws.com"
ABO_LICENSE_URL = f"{ABO_BASE_URL}/LICENSE-CC-BY-4.0.txt"
ABO_README_URL = f"{ABO_BASE_URL}/README.md"
IMAGE_METADATA_URL = f"{ABO_BASE_URL}/images/metadata/images.csv.gz"
LISTING_COUNT = 16
BUFFER_SIZE = 1024 * 1024


@dataclass(frozen=True)
class ImageMetadata:
    image_id: str
    path: str


def download(url: str, target: Path) -> None:
    if target.is_file() and target.stat().st_size > 0:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    request = Request(url, headers={"User-Agent": "imgflow-catalog-poc/1.0"})
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=target.parent,
            prefix=f".{target.name}.",
            suffix=".partial",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            with urlopen(request, timeout=60) as response:
                shutil.copyfileobj(response, temporary, BUFFER_SIZE)
    except BaseException:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
        raise
    assert temporary_path is not None
    temporary_path.replace(target)


def localized_text(value: object) -> str | None:
    if not isinstance(value, list):
        return None
    candidates: list[tuple[str, str]] = []
    for entry in value:
        if not isinstance(entry, dict):
            continue
        text = entry.get("value")
        if not isinstance(text, str) or not text.strip():
            continue
        language = entry.get("language_tag")
        candidates.append((language if isinstance(language, str) else "", text.strip()))
    if not candidates:
        return None
    candidates.sort(
        key=lambda item: (
            0 if item[0] == "en_US" else 1 if item[0].startswith("en") else 2,
            item[0],
        )
    )
    return candidates[0][1]


def load_image_metadata(path: Path) -> dict[str, ImageMetadata]:
    images: dict[str, ImageMetadata] = {}
    with gzip.open(path, mode="rt", encoding="utf-8", newline="") as source:
        for row in csv.DictReader(source):
            image_id = row.get("image_id")
            image_path = row.get("path")
            if image_id and image_path:
                images[image_id] = ImageMetadata(image_id=image_id, path=image_path)
    return images


def image_ids(listing: dict[str, Any], count: int) -> list[str]:
    resolved: list[str] = []
    main_image_id = listing.get("main_image_id")
    if isinstance(main_image_id, str):
        resolved.append(main_image_id)
    other_image_ids = listing.get("other_image_id")
    if isinstance(other_image_ids, list):
        resolved.extend(item for item in other_image_ids if isinstance(item, str))
    return list(dict.fromkeys(resolved))[:count]


def relative_image_path(item_id: str, position: int, metadata: ImageMetadata) -> Path:
    extension = Path(metadata.path).suffix.lower()
    safe_item_id = "".join(character for character in item_id if character.isalnum())[:64]
    return Path("images") / safe_item_id / f"{position:02d}-{metadata.image_id}{extension}"


def download_product_images(
    output_directory: Path,
    item_id: str,
    selected_images: list[ImageMetadata],
) -> list[str]:
    local_paths: list[str] = []
    for position, metadata in enumerate(selected_images, start=1):
        relative_path = relative_image_path(item_id, position, metadata)
        download(f"{ABO_BASE_URL}/images/small/{metadata.path}", output_directory / relative_path)
        local_paths.append(relative_path.as_posix())
    return local_paths


def read_listing_lines(path: Path) -> Iterator[dict[str, Any]]:
    with gzip.open(path, mode="rt", encoding="utf-8") as source:
        for line in source:
            value = json.loads(line)
            if isinstance(value, dict):
                yield value


def parse_args() -> argparse.Namespace:
    repository_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(
        description="Prepare a deterministic small ABO catalog for image-retrieval evaluation."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=repository_root / "local" / "data" / "abo-catalog",
    )
    parser.add_argument("--products", type=int, default=30)
    parser.add_argument("--reference-images", type=int, default=3)
    parser.add_argument("--query-images", type=int, default=1)
    parser.add_argument(
        "--max-per-product-type",
        type=int,
        default=2,
        help="Limit visually similar catalog categories in the demo subset.",
    )
    parser.add_argument(
        "--accept-license",
        action="store_true",
        help="Confirm acceptance of the ABO CC BY 4.0 license.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.accept_license:
        print(
            f"Read {ABO_LICENSE_URL}, then rerun with --accept-license.",
            file=sys.stderr,
        )
        return 2
    if (
        args.products <= 0
        or args.reference_images <= 0
        or args.query_images <= 0
        or args.max_per_product_type <= 0
    ):
        raise ValueError(
            "products, reference-images, query-images, and max-per-product-type must be positive"
        )

    output_directory: Path = args.output.resolve()
    metadata_directory = output_directory / "metadata"
    download(ABO_LICENSE_URL, output_directory / "LICENSE-CC-BY-4.0.txt")
    download(ABO_README_URL, output_directory / "ABO-README.md")
    image_metadata_path = metadata_directory / "images.csv.gz"
    download(IMAGE_METADATA_URL, image_metadata_path)
    images = load_image_metadata(image_metadata_path)

    listing_paths: list[Path] = []
    for index in range(LISTING_COUNT):
        partition = format(index, "x")
        listing_path = metadata_directory / f"listings_{partition}.json.gz"
        download(
            f"{ABO_BASE_URL}/listings/metadata/listings_{partition}.json.gz",
            listing_path,
        )
        listing_paths.append(listing_path)

    required_images = args.reference_images + args.query_images
    products: list[dict[str, object]] = []
    used_product_codes: set[str] = set()
    product_type_counts: dict[str, int] = {}
    for listing_path in listing_paths:
        for listing in read_listing_lines(listing_path):
            product_code = localized_text(listing.get("model_number"))
            product_name = localized_text(listing.get("item_name"))
            item_id = listing.get("item_id")
            product_type = localized_text(listing.get("product_type"))
            if (
                product_code is None
                or product_name is None
                or not isinstance(item_id, str)
                or product_type is None
                or product_code in used_product_codes
                or product_type_counts.get(product_type, 0) >= args.max_per_product_type
                or len(product_code) > 128
                or len(product_name) > 256
            ):
                continue
            selected_ids = image_ids(listing, required_images)
            if len(selected_ids) < required_images:
                continue
            selected_metadata = [images[image_id] for image_id in selected_ids if image_id in images]
            if len(selected_metadata) < required_images:
                continue
            try:
                local_paths = download_product_images(
                    output_directory,
                    item_id,
                    selected_metadata,
                )
            except (HTTPError, URLError) as error:
                print(f"skipping {item_id}: {error}", file=sys.stderr)
                continue

            brand = localized_text(listing.get("brand"))
            product: dict[str, object] = {
                "productCode": product_code,
                "productName": product_name,
                "referenceImages": local_paths[: args.reference_images],
                "queryImages": local_paths[args.reference_images :],
                "sourceItemId": item_id,
                "productType": product_type,
            }
            if brand is not None and len(brand) <= 128:
                product["brand"] = brand
            products.append(product)
            used_product_codes.add(product_code)
            product_type_counts[product_type] = product_type_counts.get(product_type, 0) + 1
            print(f"prepared {len(products)}/{args.products}: {product_code}")
            if len(products) == args.products:
                break
        if len(products) == args.products:
            break

    if len(products) != args.products:
        raise RuntimeError(f"Only prepared {len(products)} of {args.products} requested products")

    manifest = {
        "schemaVersion": 1,
        "source": {
            "name": "Amazon Berkeley Objects",
            "url": f"{ABO_BASE_URL}/index.html",
            "license": "CC-BY-4.0",
            "attribution": "Amazon.com and the Amazon Berkeley Objects dataset authors",
        },
        "products": products,
    }
    manifest_path = output_directory / "catalog-source.json"
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {manifest_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
