// src/utils/zip.ts

export const downloadExtension = async () => {
  // 这是你 GitHub Release 文件的真实直连下载地址
  const downloadUrl = 'https://github.com/Iris1001-coding/LingoNote/releases/download/v1.0.1/LingoNote_v1.0.1.zip';

  // 模拟点击下载逻辑
  const a = document.createElement('a');
  a.href = downloadUrl;
  // 浏览器下载时显示的文件名
  a.download = "LingoNote_extension_v1.0.1.zip"; 
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  console.log("Downloading the latest stable version from GitHub Releases...");
};
