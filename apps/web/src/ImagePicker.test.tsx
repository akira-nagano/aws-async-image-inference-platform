import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ImagePicker } from "./ImagePicker";
import { translations } from "./i18n";

describe("image picker", () => {
  it("exposes separate file and rear-camera inputs with the upload contract", () => {
    const html = renderToStaticMarkup(
      <ImagePicker
        maxUploadBytes={5 * 1024 * 1024}
        locale="en"
        messages={translations.en}
        onSelect={() => undefined}
      />,
    );

    expect(html).toContain('accept="image/jpeg,image/png"');
    expect(html).toContain('capture="environment"');
    expect(html).toContain("Choose image");
    expect(html).toContain("Take a photo");
    expect(html).toContain("Drop your image here");
  });
});
