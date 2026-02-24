export const downloadExtension = async () => {
  const downloadUrl = 'https://github.com/Iris1001-coding/LingoNote/releases/download/v1.0.1/LingoNote_v1.0.1.zip';
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = "LingoNote_v1.0.1.zip"; 
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};
