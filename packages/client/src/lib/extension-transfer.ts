import { sanitizeFolderSegment } from "@marinara-engine/shared";
import type { ZipFileInput } from "./download-zip";
import { reservePackageFolderSegment } from "./folder-package-transfer";

export type ExtensionTransferConfig = {
  name: string;
  description?: string | null;
  css?: string | null;
  js?: string | null;
  enabled: boolean;
};

export function createExtensionFolderPackageFiles(extensions: ExtensionTransferConfig[]): ZipFileInput[] {
  const usedSegments = new Set<string>();
  const entries = extensions.map((extension) => {
    const segment = reservePackageFolderSegment(extension.name, "extension", usedSegments);
    const folderPath = `Extensions/${segment}`;
    const css = extension.css ?? null;
    const js = extension.js ?? null;
    const config = {
      name: extension.name,
      description: extension.description ?? "",
      css,
      js,
      enabled: extension.enabled,
      ...(css ? { cssPath: "extension.css" } : {}),
      ...(js ? { jsPath: "extension.js" } : {}),
    };
    const manifest = {
      kind: "marinara.extension",
      version: 1 as const,
      config,
    };
    return {
      folderPath,
      entry: {
        path: `${folderPath}/manifest.json`,
        manifest,
      },
      manifest,
      config,
    };
  });

  const envelope = {
    kind: "marinara.extension-folder",
    version: 1 as const,
    exportedAt: new Date().toISOString(),
    folderName: "Extensions",
    extensions: entries.map(({ entry }) => entry),
  };

  return [
    { path: "marinara-extensions.json", content: JSON.stringify(envelope, null, 2) },
    ...entries.flatMap(({ folderPath, manifest, config }) => [
      { path: `${folderPath}/manifest.json`, content: JSON.stringify(manifest, null, 2) },
      ...(config.css ? [{ path: `${folderPath}/extension.css`, content: config.css }] : []),
      ...(config.js ? [{ path: `${folderPath}/extension.js`, content: config.js }] : []),
    ]),
  ];
}

export function createExtensionFolderPackageFilename(name: string, fallback = "extension") {
  return `${sanitizeFolderSegment(name, fallback)}.extension.zip`;
}
