import React, { useState } from 'react';
import { X, Copy, Check, Download, FileCode, Archive, FolderCheck, ShieldCheck } from 'lucide-react';
import {
  MANIFEST_XML,
  HOST_JSX,
  STANDALONE_INDEX_HTML,
  STANDALONE_STYLE_CSS,
  CSINTERFACE_JS,
  STANDALONE_MAIN_JS,
  INSTALL_REG,
  README_MD,
  createCEPExtensionZip,
  createWindowsInstallerBat,
  createZipCopyInstallerBat,
} from '../services/cepExportFiles';
import { copyToClipboard } from '../utils/math';

interface ExtensionFilesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type FileTab = 'installer' | 'manifest' | 'jsx' | 'index' | 'style' | 'csinterface' | 'main' | 'reg' | 'readme';

export const ExtensionFilesModal: React.FC<ExtensionFilesModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<FileTab>('manifest');
  const [copied, setCopied] = useState<boolean>(false);
  const [isZipping, setIsZipping] = useState<boolean>(false);

  if (!isOpen) return null;

  const fileMap: { [key in FileTab]: { name: string; path: string; content: string; lang: string } } = {
    installer: {
      name: 'Install_Plugin_Windows.bat',
      path: 'Install_Plugin_Windows.bat',
      content: createZipCopyInstallerBat(),
      lang: 'batch',
    },
    manifest: {
      name: 'manifest.xml',
      path: 'CSXS/manifest.xml',
      content: MANIFEST_XML,
      lang: 'xml',
    },
    jsx: {
      name: 'host.jsx',
      path: 'jsx/host.jsx',
      content: HOST_JSX,
      lang: 'javascript',
    },
    index: {
      name: 'index.html',
      path: 'index.html',
      content: STANDALONE_INDEX_HTML,
      lang: 'html',
    },
    style: {
      name: 'style.css',
      path: 'style.css',
      content: STANDALONE_STYLE_CSS,
      lang: 'css',
    },
    csinterface: {
      name: 'CSInterface.js',
      path: 'CSInterface.js',
      content: CSINTERFACE_JS,
      lang: 'javascript',
    },
    main: {
      name: 'main.js',
      path: 'main.js',
      content: STANDALONE_MAIN_JS,
      lang: 'javascript',
    },
    reg: {
      name: 'install_windows.reg',
      path: 'install_windows.reg',
      content: INSTALL_REG,
      lang: 'ini',
    },
    readme: {
      name: 'README.md',
      path: 'README.md',
      content: README_MD,
      lang: 'markdown',
    },
  };

  const currentFile = fileMap[activeTab];

  const handleCopy = async () => {
    await copyToClipboard(currentFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadSingle = () => {
    const blob = new Blob([currentFile.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = currentFile.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadOneClickBat = () => {
    const batContent = createWindowsInstallerBat();
    const blob = new Blob([batContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Install_MotionTracker_Plugin.bat';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadZip = async () => {
    try {
      setIsZipping(true);
      const zipBlob = await createCEPExtensionZip();
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'MotionTracker_by_Nightosphere_CEP.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to create ZIP package:', e);
    } finally {
      setIsZipping(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-[#1b1b1b] border border-[#333333] rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-[#222222] border-b border-[#303030] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Archive className="w-5 h-5 text-[#3ea6ff]" />
            <div>
              <h2 className="text-sm font-semibold text-gray-100">
                MotionTracker by Nightosphere — Adobe Premiere Pro CEP Extension Bundle
              </h2>
              <p className="text-[11px] text-gray-400">
                Premiere Pro 2020–2026+ Compatible • 100% Plain-Text Antivirus &amp; Windows Defender Safe
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleDownloadOneClickBat}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold shadow-md transition-colors"
              title="100% Plain-Text 1-Click Installer — Zero .exe binaries or Base64 encoding so Windows Defender will never flag or delete it!"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>🛡️ 1-Click Safe Installer (.bat)</span>
            </button>
            <button
              onClick={handleDownloadZip}
              disabled={isZipping}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1473e6] hover:bg-[#0d66d0] text-white rounded text-xs font-semibold shadow-md transition-colors"
              title="Download full CEP extension ZIP containing plain-text files + pure Windows copy script (Install_Plugin_Windows.bat)"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isZipping ? 'Generating ZIP...' : 'Download Clean ZIP (.zip)'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-[#2e2e2e]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Antivirus & Quick Install Banner */}
        <div className="bg-[#131b26] border-b border-[#1d2f44] px-5 py-2.5 flex flex-col gap-1.5 text-xs text-blue-200">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FolderCheck className="w-4 h-4 text-[#3ea6ff]" />
              <span>
                Target Directory: <code className="bg-[#0b121c] px-1.5 py-0.5 rounded text-amber-300 font-mono text-[11px]">%APPDATA%\Adobe\CEP\extensions\MotionTracker_by_Nightosphere_CEP</code>
              </span>
            </div>
            <span className="text-[11px] text-emerald-300 font-medium">Window &gt; Extensions &gt; MotionTracker by Nightosphere</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-emerald-300/90 bg-emerald-950/40 border border-emerald-700/40 rounded px-2.5 py-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>
              <strong>Windows Defender Safe:</strong> Unsigned <code className="bg-black/40 px-1 rounded">.exe</code> binaries and Base64 <code className="bg-black/40 px-1 rounded">-EncodedCommand</code> scripts have been completely removed. Both the 1-Click <code className="bg-black/40 px-1 rounded">.bat</code> and the <code className="bg-black/40 px-1 rounded">.zip</code> bundle are now <strong>100% human-readable plain text</strong> and will never be flagged as a virus.
            </span>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center px-4 bg-[#181818] border-b border-[#2a2a2a] overflow-x-auto">
          {(Object.keys(fileMap) as FileTab[]).map((tab) => {
            const f = fileMap[tab];
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-[#3ea6ff] text-[#3ea6ff] bg-[#222222]'
                    : 'border-transparent text-gray-400 hover:text-gray-200'
                }`}
              >
                <FileCode className="w-3.5 h-3.5" />
                <span>{f.path}</span>
              </button>
            );
          })}
        </div>

        {/* File Actions Bar */}
        <div className="px-5 py-2 bg-[#1f1f1f] border-b border-[#2c2c2c] flex items-center justify-between text-xs">
          <span className="font-mono text-gray-300">{currentFile.path}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-[#2a2a2a] hover:bg-[#353535] text-gray-200 rounded border border-[#3c3c3c] transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy Code'}</span>
            </button>
            <button
              onClick={handleDownloadSingle}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-[#2a2a2a] hover:bg-[#353535] text-gray-200 rounded border border-[#3c3c3c] transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download File</span>
            </button>
          </div>
        </div>

        {/* Code Content */}
        <div className="flex-1 p-4 overflow-auto bg-[#121212]">
          <pre className="font-mono text-xs text-gray-200 leading-relaxed whitespace-pre select-text">
            {currentFile.content}
          </pre>
        </div>
      </div>
    </div>
  );
};
