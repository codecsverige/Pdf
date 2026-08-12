# PDF Pro Tools

React Native / Expo PDF utility app focused on real offline PDF transformations.

## Implemented on `feat/pdf-pro-tools`

- Merge multiple PDF files
- Extract selected pages using expressions such as `1-3,5,8`
- Reorder every page into a new order
- Rotate all pages or selected pages by 90/180/270 degrees
- Add a permanent text watermark to every page
- Add permanent page numbers
- Convert multiple images to A4 PDF pages
- Save/share the generated PDF through the native share sheet

The PDF operations use `pdf-lib`; file IO uses the Expo SDK 54 legacy filesystem entry point required by the installed API version.

## Intentionally not exposed yet

These tools are not shown in the UI until a real implementation is integrated and tested:

- Strong PDF compression of arbitrary existing PDFs
- Password encryption / protection
- Password removal
- PDF to image rendering
- Full PDF text editing
- OCR

The project must not ship placeholder buttons for these features.

## Development

```bash
npm ci
npx tsc --noEmit
npx expo start
```

For an Android native build:

```bash
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
```

## CI

`.github/workflows/ci.yml` runs `npm ci` and TypeScript validation on pushes and pull requests.
