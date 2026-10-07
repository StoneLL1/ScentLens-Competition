# 闻见 ScentLens

闻见 ScentLens 是配合 Pocket 气味感知硬件的 iOS App，将一次试香转化为八维气味画像与视觉作品。

- 通过蓝牙连接 Pocket，完成背景准备与气味采样。
- 展示八维气味特征，并生成气味场景文字与图像。
- 将记录和原图保存在本机，支持离线回看、香廊归档与再次试香。
- 支持保存原图到相册和分享品牌作品卡。

此仓库为比赛提交的 App 源码快照，包含 React + TypeScript 前端、Capacitor iOS 工程及图像生成 API。

## 本地预览

使用 Node.js 22.12–24：

```bash
npm ci
npm run dev
```

打开终端显示的本机地址。默认预览使用明确标记的模拟八维、文字和固定测试图；真实采样需要 Pocket 与 iPhone，真实生成需要另行配置服务端模型与访问凭据。

```bash
npm run build
npm test
```

## iOS

需要 macOS、Xcode 26+ 和 iOS 16.4+。本地固定作品模式可用 `npm run ios:sync:fixture` 同步，再通过 `npm run ios:open` 打开工程并选择自己的签名 Team。真实云端构建使用 `.env.example` 中的公开 API 地址并执行 `npm run ios:sync`。

## 版权

项目原创部分的版权声明见 [LICENSE](LICENSE)；第三方组件、字体及素材声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本仓库不包含模型密钥、演示访问码、签名私钥或个人设备数据。
