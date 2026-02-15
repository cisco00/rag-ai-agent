import React, { useState, useRef } from 'react';
import { Upload, FileType, CheckCircle, AlertTriangle, X, Eye } from 'lucide-react';
import { api } from '../services/api';
import { PreviewFileModal } from './PreviewFileModal';

export const FileImport: React.FC = () => {
    const [isDragging, setIsDragging] = useState(false);
    const [files, setFiles] = useState<File[]>([]);
    const [uploading, setUploading] = useState(false);
    const [status, setStatus] = useState<any>(null);
    const [previewData, setPreviewData] = useState<any>(null);
    const [previewFile, setPreviewFile] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => setIsDragging(false);

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files) {
            addFiles(Array.from(e.dataTransfer.files));
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            addFiles(Array.from(e.target.files));
        }
    };

    const addFiles = (newFiles: File[]) => {
        // Filter for allowed types
        const allowed = newFiles.filter(f =>
            f.name.endsWith('.csv') ||
            f.name.endsWith('.xlsx') ||
            f.name.endsWith('.xls')
        );
        setFiles(prev => [...prev, ...allowed].slice(0, 20)); // Max 20
    };

    const removeFile = (index: number) => {
        setFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handlePreview = async (file: File) => {
        try {
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) throw new Error('No API key found');

            // Show some loading state if needed, or just rely on quick catch
            const data = await api.analyzeFile(file, apiKey);
            setPreviewData(data);
            setPreviewFile(file);
        } catch (err: any) {
            setStatus({ status: 'failed', error: `Preview failed: ${err.message}` });
        }
    };

    const closePreview = () => {
        setPreviewData(null);
        setPreviewFile(null);
    };

    const handleConfirmImport = async (cleaningOptions?: any) => {
        if (!previewFile) return;

        try {
            setUploading(true);
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) throw new Error('No API key found');

            const result = await api.importBatch([previewFile], apiKey, cleaningOptions);

            if (result.status === 'success' || result.status === 'partial') {
                setStatus(result);
                // Remove the imported file from the list
                setFiles(prev => prev.filter(f => f !== previewFile));
                closePreview();
            } else {
                throw new Error(result.error);
            }
        } catch (err: any) {
            setStatus({ status: 'failed', error: err.message });
            // Don't close preview on error so they can try again or see what's wrong? 
            // Or maybe they should just see the error in the main screen. 
            // For now let's keep the modal open? 
            // Actually, showing error in the modal might be better, but the status message is on the parent.
            // Let's close modal and show error on parent.
            closePreview();
        } finally {
            setUploading(false);
        }
    };

    const handleUpload = async () => {
        if (files.length === 0) return;

        try {
            setUploading(true);
            const apiKey = localStorage.getItem('vantage_api_key');
            if (!apiKey) throw new Error('No API key found');

            const result = await api.importBatch(files, apiKey);
            setStatus(result);
            if (result.status === 'success' || result.status === 'partial') {
                setFiles([]); // Clear queue on success
            }
        } catch (err: any) {
            setStatus({ status: 'error', error: err.message });
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="card-panel">
            <div className="panel-content">
                <div
                    className={`drop-zone ${isDragging ? 'dragging' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <Upload size={32} className="upload-icon" />
                    <p className="primary-text">Click or drag files to upload</p>
                    <p className="secondary-text">CSV, Excel (max 20 files)</p>
                    <input
                        type="file"
                        multiple
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        hidden
                        accept=".csv,.xlsx,.xls"
                    />
                </div>

                {files.length > 0 && (
                    <div className="file-list">
                        <h4>Selected Files ({files.length})</h4>
                        <ul>
                            {files.map((f, i) => (
                                <li key={i}>
                                    <div className="file-info">
                                        <FileType size={16} />
                                        <span className="filename">{f.name}</span>
                                    </div>
                                    <div className="file-actions">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handlePreview(f); }}
                                            className="action-btn preview-btn"
                                            title="Preview File"
                                        >
                                            <Eye size={14} />
                                        </button>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                                            className="action-btn delete-btn"
                                            title="Remove"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                        <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                            <button
                                className="btn btn-secondary full-width"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading}
                            >
                                Add More Files
                            </button>
                            <button
                                className="btn btn-primary full-width"
                                onClick={handleUpload}
                                disabled={uploading}
                            >
                                {uploading ? 'Uploading...' : 'Import All Files'}
                            </button>
                        </div>
                    </div>
                )}

                {status && (
                    <div className={`status-message ${status.status}`}>
                        {status.status === 'success' && (
                            <>
                                <CheckCircle size={18} />
                                <div>
                                    <p>Import Successful!</p>
                                    <small>{status.successful} files imported.</small>
                                </div>
                            </>
                        )}
                        {status.status === 'failed' && (
                            <>
                                <AlertTriangle size={18} />
                                <div>
                                    <p>Import Failed</p>
                                    <small>{status.error || 'Unknown error occurred'}</small>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {previewData && previewFile && (
                    <PreviewFileModal
                        fileData={previewData}
                        uploading={uploading}
                        onConfirm={handleConfirmImport}
                        onCancel={closePreview}
                    />
                )}
            </div>
            <style>{`
                .drop-zone {
                    border: 2px dashed var(--color-border);
                    border-radius: 12px;
                    padding: 2rem;
                    text-align: center;
                    cursor: pointer;
                    transition: all 0.2s;
                    background: #f8fafc;
                }
                .drop-zone:hover, .drop-zone.dragging {
                    border-color: var(--color-primary);
                    background: #eff6ff;
                }
                .upload-icon { color: var(--color-text-muted); margin-bottom: 1rem; }
                .primary-text { font-weight: 500; color: var(--color-text-primary); margin-bottom: 0.25rem; }
                .secondary-text { font-size: 0.85rem; color: var(--color-text-muted); }
                
                .file-list { margin-top: 1.5rem; }
                .file-list h4 { font-size: 0.9rem; margin-bottom: 0.5rem; }
                .file-list ul { list-style: none; padding: 0; margin-bottom: 1rem; max-height: 150px; overflow-y: auto; }
                .file-list li {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 0.5rem;
                    background: #fff;
                    border: 1px solid var(--color-border);
                    border-radius: 6px;
                    margin-bottom: 0.25rem;
                    font-size: 0.85rem;
                }
                .file-info { display: flex; align-items: center; gap: 0.5rem; flex: 1; min-width: 0; }
                .file-list li .filename { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
                
                .file-actions { display: flex; gap: 0.5rem; }
                .action-btn { 
                    border: none; 
                    background: none; 
                    cursor: pointer; 
                    padding: 4px;
                    border-radius: 4px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .preview-btn { color: var(--color-primary); background: #eff6ff; }
                .preview-btn:hover { background: #dbeafe; }
                .delete-btn { color: var(--color-text-muted); }
                .delete-btn:hover { color: #ef4444; background: #fee2e2; }

                .status-message {
                    margin-top: 1.5rem;
                    padding: 1rem;
                    border-radius: 8px;
                    display: flex;
                    gap: 0.75rem;
                    align-items: flex-start;
                }
                .status-message.success { background: #dcfce7; color: #166534; }
                .status-message.failed { background: #fee2e2; color: #991b1b; }
            `}</style>
        </div>
    );
};
