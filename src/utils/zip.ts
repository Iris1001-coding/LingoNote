import JSZip from 'jszip';

export const downloadExtension = async () => {
  const zip = new JSZip();
  const folder = zip.folder('lingonote-extension');

  const files = [
    {name: 'manifest.json', binary: false},
    {name: 'content.js', binary: false},
    {name: 'styles.css', binary: false},
    {name: 'popup.html', binary: false},
    {name: 'popup.js', binary: false},
    {name: 'icon.png', binary: true},
  ];

  try {
    let manifestVersion = '1.0.0';

    for (const file of files) {
      const response = await fetch(`./extension/${file.name}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${file.name}: ${response.status}`);
      }

      if (file.name === 'manifest.json') {
        const manifestText = await response.text();
        folder?.file(file.name, manifestText);
        try {
          const manifest = JSON.parse(manifestText) as {version?: string};
          if (manifest.version) manifestVersion = manifest.version;
        } catch (parseError) {
          console.warn('Failed to parse manifest version from manifest.json', parseError);
        }
        continue;
      }

      if (file.binary) {
        const content = await response.arrayBuffer();
        folder?.file(file.name, content);
      } else {
        const content = await response.text();
        folder?.file(file.name, content);
      }
    }

    const safeVersion = manifestVersion.replace(/[^0-9A-Za-z._-]/g, '_');
    const content = await zip.generateAsync({type: 'blob'});
    const url = window.URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LingNote_v${safeVersion}.zip`;
    a.click();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Failed to zip extension:', error);
    alert('Failed to download extension files. Please try again.');
  }
};
