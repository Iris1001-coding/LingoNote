import JSZip from 'jszip';

export const downloadExtension = async () => {
  const zip = new JSZip();
  const folder = zip.folder("lingonote-extension");

  const files = [
    'manifest.json',
    'content.js',
    'styles.css',
    'popup.html'
  ];

  try {
    for (const file of files) {
      const response = await fetch(`/extension/${file}`);
      const content = await response.text();
      folder?.file(file, content);
    }

    const content = await zip.generateAsync({ type: "blob" });
    const url = window.URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = "lingonote-extension.zip";
    a.click();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Failed to zip extension:", error);
    alert("Failed to download extension files. Please try again.");
  }
};
