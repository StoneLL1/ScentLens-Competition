import Capacitor
import Photos
import UIKit

// Local bridge: no album read access, image re-encoding, or business-store writes.
@objc(ScentLensExportPlugin)
public class ScentLensExportPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ScentLensExportPlugin"
    public let jsName = "ScentLensExport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "saveToAlbum", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]
    // Accessed on the main queue; remains locked through the system completion callback.
    private var busy = false

    private func imagePayload(_ call: CAPPluginCall) -> (Data, String)? {
        guard let encoded = call.getString("base64"), encoded.count <= 35 * 1024 * 1024,
              let ext = call.getString("extension"), ["png", "jpg", "webp"].contains(ext),
              let data = Data(base64Encoded: encoded), !data.isEmpty, data.count <= 25 * 1024 * 1024,
              let image = UIImage(data: data), image.size.width > 0 else {
            call.reject("图片文件无效，请重新准备。", "INVALID_IMAGE")
            return nil
        }
        return (data, ext)
    }

    @objc func saveToAlbum(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard !self.busy else { call.reject("已有导出正在处理。", "BUSY"); return }
            guard let (data, ext) = self.imagePayload(call) else { return }
            self.busy = true
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
                guard status == .authorized || status == .limited else {
                    DispatchQueue.main.async {
                        self.busy = false
                        call.reject("未获得照片添加权限。", status == .restricted ? "PHOTO_RESTRICTED" : "PHOTO_DENIED")
                    }
                    return
                }
                PHPhotoLibrary.shared().performChanges {
                    let options = PHAssetResourceCreationOptions()
                    options.originalFilename = "ScentLens-\(UUID().uuidString).\(ext)"
                    // Supply the original bytes to PhotoKit, never UIImage's recompressed output.
                    PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: options)
                } completionHandler: { success, _ in
                    DispatchQueue.main.async {
                        self.busy = false
                        if success { call.resolve() }
                        else { call.reject("相册写入失败，请检查可用空间后重试。本机作品仍保留。", "ALBUM_WRITE_FAILED") }
                    }
                }
            }
        }
    }

    @objc func share(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard !self.busy else { call.reject("已有导出正在处理。", "BUSY"); return }
            guard let (data, ext) = self.imagePayload(call) else { return }
            guard let presenter = self.bridge?.viewController, presenter.viewIfLoaded?.window != nil,
                  presenter.presentedViewController == nil else {
                call.reject("暂时无法打开系统分享，请返回作品后重试。", "PRESENTATION_FAILED"); return
            }
            do {
                let directory = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                    .appendingPathComponent("ScentLensExports", isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                // Only our own exports, older than 24 hours. Never remove on sheet dismissal.
                let previous = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey])
                for file in previous where file.lastPathComponent.hasPrefix("ScentLens-") {
                    if let modified = try? file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate,
                       modified.timeIntervalSinceNow < -86400 { try? FileManager.default.removeItem(at: file) }
                }
                let file = directory.appendingPathComponent("ScentLens-\(UUID().uuidString).\(ext)")
                try data.write(to: file, options: .atomic)
                let activity = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                activity.popoverPresentationController?.sourceView = presenter.view
                activity.popoverPresentationController?.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
                self.busy = true
                activity.completionWithItemsHandler = { _, completed, _, error in
                    DispatchQueue.main.async {
                        self.busy = false
                        // Give receivers a full grace period after completion, even after a long sheet session.
                        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: file.path)
                        if error != nil { call.reject("分享未完成，请重试。本机作品仍保留。", "SHARE_FAILED") }
                        else { call.resolve(["completed": completed]) }
                    }
                }
                presenter.present(activity, animated: true)
            } catch { call.reject("分享文件准备失败，请检查可用空间后重试。", "EXPORT_WRITE_FAILED") }
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { call.reject("无法打开系统设置。"); return }
            UIApplication.shared.open(url) { opened in
                if opened { call.resolve() } else { call.reject("无法打开系统设置，请手动前往设置中的闻见 ScentLens。"); }
            }
        }
    }
}

class ScentLensViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(ScentLensExportPlugin()) }
}
