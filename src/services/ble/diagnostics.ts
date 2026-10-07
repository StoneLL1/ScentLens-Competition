import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
export async function savePocketDiagnostics(diagnostics: unknown) {
  await Filesystem.writeFile({ directory: Directory.Data, path: 'diagnostics/pocket.json', data: JSON.stringify(diagnostics, null, 2), encoding: Encoding.UTF8, recursive: true })
}
