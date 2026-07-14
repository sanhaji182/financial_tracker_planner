import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  UploadCloud, 
  Trash2, 
  Download, 
  Link, 
  Search, 
  Tag as TagIcon, 
  Eye, 
  X, 
  AlertCircle, 
  Loader2,
  Layers,
  Database
} from 'lucide-react';
import documentsService, { type Document } from '../services/documents';
import { useAssets } from '../hooks/useAssets';
import { useDebts } from '../hooks/useDebts';
import { transactionsService } from '../services/transactions';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { useAuthStore } from '../stores/authStore';
import { CardSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';

export const DocumentCenterPage: React.FC = () => {
  const { user } = useAuthStore();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEntityType, setSelectedEntityType] = useState('');
  const [selectedTag, setSelectedTag] = useState('');

  // Upload States
  const [dragActive, setDragActive] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Link Modal States
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [documentToLink, setDocumentToLink] = useState<Document | null>(null);
  const [linkEntityType, setLinkEntityType] = useState<'transaction' | 'asset' | 'debt'>('transaction');
  const [linkEntityId, setLinkEntityId] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isLinking, setIsLinking] = useState(false);

  // Available Entities lists for Link Modal
  const { data: assets } = useAssets();
  const { data: debts } = useDebts();
  const [transactions, setTransactions] = useState<any[]>([]);

  // Lightbox Preview State
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxName, setLightboxName] = useState('');
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  const fetchDocuments = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const data = await documentsService.getDocuments(selectedEntityType || undefined, selectedTag || undefined);
      setDocuments(data);
    } catch (err: any) {
      setErrorMsg(err.message || 'Gagal mengambil daftar dokumen');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchTransactions = async () => {
    try {
      const res = await transactionsService.getTransactions({ page: 1, page_size: 100 });
      setTransactions(res.data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments, selectedEntityType, selectedTag]);

  useEffect(() => {
    fetchTransactions();
  }, []);

  useEffect(() => {
    let active = true;
    const createdUrls: string[] = [];
    const imageDocuments = documents.filter((doc) => doc.file_type.startsWith('image/'));

    Promise.all(
      imageDocuments.map(async (doc) => {
        const objectUrl = await documentsService.getDocumentObjectURL(doc.id);
        createdUrls.push(objectUrl);
        return [doc.id, objectUrl] as const;
      })
    )
      .then((entries) => {
        if (active) setPreviewUrls(Object.fromEntries(entries));
      })
      .catch(() => {
        if (active) setPreviewUrls({});
      });

    return () => {
      active = false;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [documents]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (file: File) => {
    setUploadError(null);
    // Format check
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      setUploadError('Hanya mendukung format PDF, JPG, PNG, atau JPEG.');
      return;
    }
    // Size check (10MB)
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('Ukuran file melebihi batas maksimum 10MB.');
      return;
    }
    setUploadFile(file);
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const tagsArray = uploadTags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t !== '');

      await documentsService.uploadDocument({
        file: uploadFile,
        description: uploadDescription,
        tags: tagsArray,
      });

      // Clear states
      setUploadFile(null);
      setUploadDescription('');
      setUploadTags('');
      fetchDocuments();
    } catch (err: any) {
      setUploadError(err.response?.data?.error?.message || 'Gagal mengunggah dokumen');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Apakah Anda yakin ingin menghapus dokumen ini? File fisik juga akan dihapus.')) return;
    try {
      await documentsService.deleteDocument(id);
      fetchDocuments();
    } catch (err: any) {
      alert(err.message || 'Gagal menghapus dokumen');
    }
  };

  const handleOpenLinkModal = (doc: Document) => {
    setDocumentToLink(doc);
    setLinkEntityType('transaction');
    setLinkEntityId('');
    setLinkError(null);
    setLinkModalOpen(true);
  };

  const handleLinkSubmit = async () => {
    if (!documentToLink || !linkEntityId) return;
    setIsLinking(true);
    setLinkError(null);
    try {
      await documentsService.linkDocument(documentToLink.id, linkEntityType, linkEntityId);
      setLinkModalOpen(false);
      fetchDocuments();
    } catch (err: any) {
      setLinkError(err.response?.data?.error?.message || 'Gagal menghubungkan dokumen');
    } finally {
      setIsLinking(false);
    }
  };

  // Extract unique tags for tag filter
  const allTags = Array.from(
    new Set(documents.flatMap((doc) => doc.tags || []))
  );

  // Search filter
  const filteredDocuments = documents.filter((doc) =>
    doc.file_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (doc.description && doc.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );



  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  };

  const isImage = (type: string) => {
    return type.startsWith('image/');
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg">
            <FileText className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Document Center</h1>
            <p className="text-sm text-slate-400">Penyimpanan struk, sertifikat aset, bukti cicilan, dan berkas keuangan resmi</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Upload Zone (Only Owner can upload) */}
        {user?.role === 'owner' && (
          <div className="lg:col-span-4 space-y-4">
            <Card className="p-4 bg-slate-900 border-white/5 space-y-4">
              <h3 className="text-sm font-bold text-slate-200">Unggah Dokumen</h3>

              <div
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-all ${
                  dragActive
                    ? 'border-indigo-500 bg-indigo-500/10'
                    : 'border-slate-800 hover:border-slate-700 bg-slate-950/20'
                }`}
              >
                <input
                  type="file"
                  id="doc-upload"
                  className="hidden"
                  onChange={handleFileChange}
                  accept=".pdf,image/png,image/jpeg,image/jpg"
                />

                <label htmlFor="doc-upload" className="cursor-pointer block space-y-2">
                  <UploadCloud className="h-10 w-10 text-slate-400 mx-auto" />
                  <div className="text-xs text-slate-300 font-semibold">
                    Drag & drop file Anda, atau <span className="text-indigo-400 font-bold">pilih file</span>
                  </div>
                  <div className="text-[10px] text-slate-500">
                    PDF, JPG, JPEG, atau PNG (Maks 10MB)
                  </div>
                </label>
              </div>

              {uploadError && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-950/20 p-3 text-xs text-red-700 dark:text-red-400">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}

              {uploadFile && (
                <form onSubmit={handleUploadSubmit} className="space-y-3">
                  <div className="rounded-lg bg-slate-800 p-2.5 flex items-center justify-between text-xs text-slate-300">
                    <span className="truncate max-w-[180px] font-semibold">{uploadFile.name}</span>
                    <button
                      type="button"
                      onClick={() => setUploadFile(null)}
                      className="text-slate-400 hover:text-white"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Description input */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Keterangan</label>
                    <input
                      type="text"
                      value={uploadDescription}
                      onChange={(e) => setUploadDescription(e.target.value)}
                      placeholder="Masukkan deskripsi berkas"
                      className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs font-semibold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-200"
                    />
                  </div>

                  {/* Tags input */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tag (pisahkan dengan koma)</label>
                    <input
                      type="text"
                      value={uploadTags}
                      onChange={(e) => setUploadTags(e.target.value)}
                      placeholder="struk, aset, pajak"
                      className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs font-semibold focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-200"
                    />
                  </div>

                  <Button
                    type="submit"
                    variant="primary"
                    className="w-full flex items-center justify-center gap-1.5 py-2 text-xs"
                    disabled={isUploading}
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Mengunggah...
                      </>
                    ) : (
                      'Simpan Berkas'
                    )}
                  </Button>
                </form>
              )}
            </Card>
          </div>
        )}

        {/* Documents Grid Area */}
        <div className={user?.role === 'owner' ? 'lg:col-span-8 space-y-4' : 'lg:col-span-12 space-y-4'}>
          {/* Controls Card */}
          <Card className="p-4 bg-slate-900 border-white/5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {/* Entity filter dropdown */}
              <select
                value={selectedEntityType}
                onChange={(e) => setSelectedEntityType(e.target.value)}
                className="rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200"
              >
                <option value="">Semua Dokumen</option>
                <option value="transaction">Terhubung Transaksi</option>
                <option value="asset">Terhubung Aset</option>
                <option value="debt">Terhubung Utang</option>
                <option value="bill">Terhubung Tagihan</option>
              </select>

              {/* Active Tag filter indicator */}
              {selectedTag && (
                <span className="flex items-center gap-1 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-xs px-2.5 py-1 rounded-full font-bold">
                  Tag: {selectedTag}
                  <button onClick={() => setSelectedTag('')} className="hover:text-white">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              )}
            </div>

            {/* Search Bar */}
            <div className="relative max-w-xs w-full">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-3.5 w-3.5 text-slate-500" />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari file..."
                className="w-full rounded-lg border border-slate-800 bg-slate-950/40 pl-9 pr-3 py-1.5 text-xs font-semibold text-slate-200 placeholder-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </Card>

          {/* Tags cloud preview */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 mr-1">
                <TagIcon className="h-3 w-3" /> Filter Tag:
              </span>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setSelectedTag(tag === selectedTag ? '' : tag)}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-all border ${
                    tag === selectedTag
                      ? 'bg-indigo-500 text-white border-indigo-600 shadow-sm'
                      : 'bg-slate-900 text-slate-400 border-white/5 hover:text-slate-200'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}

          {/* Main Grid display */}
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map(n => (
                <CardSkeleton key={n} />
              ))}
            </div>
          ) : errorMsg ? (
            <div className="py-12 text-center text-red-500 text-sm font-semibold">
              {errorMsg}
            </div>
          ) : filteredDocuments.length === 0 ? (
            <EmptyState
              title="Tidak ada dokumen ditemukan"
              description="Belum ada berkas (setruk/invoice/kontrak) yang diunggah ke repositori Anda, atau cobalah ubah filter pencarian."
              icon={FileText}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredDocuments.map((doc) => (
                <Card 
                  key={doc.id} 
                  className="p-4 bg-slate-900/60 border-white/5 hover:border-slate-800 transition-all flex flex-col justify-between space-y-4"
                >
                  <div>
                    {/* File preview thumbnail or icon */}
                    <div className="h-36 rounded-lg bg-slate-950 overflow-hidden relative group border border-white/5 flex items-center justify-center">
                      {isImage(doc.file_type) ? (
                        <>
                          <img
                            src={previewUrls[doc.id] || ''}
                            alt={doc.file_name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-all"
                          />
                          <button
                            onClick={() => {
                              setLightboxUrl(previewUrls[doc.id] || null);
                              setLightboxName(doc.file_name);
                            }}
                            className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                          >
                            <Eye className="h-6 w-6 mr-1" />
                            <span className="text-xs font-bold">Preview</span>
                          </button>
                        </>
                      ) : (
                        <div className="text-center p-4">
                          <FileText className="h-12 w-12 text-indigo-500 mx-auto mb-2" />
                          <span className="text-[10px] bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 font-bold px-2 py-0.5 rounded uppercase">
                            {doc.file_type.split('/')[1] || 'PDF'}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* File Meta */}
                    <div className="mt-3 space-y-1">
                      <div className="flex justify-between items-start gap-1">
                        <h4 className="text-xs font-bold text-slate-200 truncate flex-1" title={doc.file_name}>
                          {doc.file_name}
                        </h4>
                        <span className="text-[10px] text-slate-500 font-bold shrink-0">{formatBytes(doc.file_size)}</span>
                      </div>
                      {doc.description && (
                        <p className="text-[11px] text-slate-400 line-clamp-2">{doc.description}</p>
                      )}
                      
                      {/* Linked tag or label */}
                      {doc.linked_entity_type && (
                        <div className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md mt-1">
                          <Layers className="h-3 w-3" />
                          Terhubung: {
                            doc.linked_entity_type === 'transaction' ? 'Transaksi' :
                            doc.linked_entity_type === 'asset' ? 'Aset' :
                            doc.linked_entity_type === 'debt' ? 'Utang' : doc.linked_entity_type
                          }
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions & tags list */}
                  <div className="space-y-3 pt-2 border-t border-white/5">
                    {doc.tags && doc.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {doc.tags.map((tag) => (
                          <span key={tag} className="text-[9px] font-bold bg-white/5 text-slate-400 px-1.5 py-0.5 rounded">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => void documentsService.downloadDocument(doc.id, doc.file_name)}
                        className="flex-1 border border-white/10 py-1.5 text-[10px] font-bold flex items-center justify-center gap-1 hover:bg-white/5"
                      >
                        <Download className="h-3.5 w-3.5" /> Unduh
                      </Button>

                      {user?.role === 'owner' && (
                        <>
                          <Button
                            variant="ghost"
                            onClick={() => handleOpenLinkModal(doc)}
                            className="w-full border border-white/10 py-1.5 text-[10px] font-bold flex items-center justify-center gap-1 hover:bg-white/5"
                          >
                            <Link className="h-3.5 w-3.5 text-indigo-400" /> Hubungkan
                          </Button>

                          <button
                            onClick={() => handleDelete(doc.id)}
                            className="p-1.5 rounded-lg border border-red-500/20 hover:bg-red-500/10 text-red-400 transition-colors"
                            title="Hapus"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Link Entity Modal */}
      <Modal
        isOpen={linkModalOpen}
        onClose={() => setLinkModalOpen(false)}
        title="Hubungkan Dokumen ke Finansial"
        footerActions={
          <>
            <Button variant="ghost" onClick={() => setLinkModalOpen(false)} disabled={isLinking}>
              Batal
            </Button>
            <Button variant="primary" onClick={handleLinkSubmit} disabled={isLinking || !linkEntityId}>
              {isLinking ? 'Menghubungkan...' : 'Hubungkan Berkas'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {linkError && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-950/20 p-3 text-xs text-red-700 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{linkError}</span>
            </div>
          )}

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 mb-1">
              <Database className="h-3.5 w-3.5" /> Tipe Entitas
            </label>
            <select
              value={linkEntityType}
              onChange={(e) => {
                setLinkEntityType(e.target.value as any);
                setLinkEntityId('');
              }}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200"
            >
              <option value="transaction">Transaksi Keuangan</option>
              <option value="asset">Aset Fisik/Liquid</option>
              <option value="debt">Utang & Pinjaman</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1 mb-1">
              Pilih Item
            </label>
            <select
              value={linkEntityId}
              onChange={(e) => setLinkEntityId(e.target.value)}
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-200"
            >
              <option value="">-- Pilih salah satu --</option>
              
              {linkEntityType === 'transaction' &&
                transactions.map((tx) => (
                  <option key={tx.id} value={tx.id}>
                    [{tx.date}] {tx.formatted_amount} - {tx.description || 'Tanpa deskripsi'}
                  </option>
                ))}

              {linkEntityType === 'asset' &&
                assets?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} (Value: Rp {a.current_value.toLocaleString()})
                  </option>
                ))}

              {linkEntityType === 'debt' &&
                debts?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} (Sisa: Rp {d.outstanding_balance.toLocaleString()})
                  </option>
                ))}
            </select>
          </div>
        </div>
      </Modal>

      {/* Image Lightbox Modal */}
      {lightboxUrl && (
        <div 
          className="fixed inset-0 bg-slate-950/90 z-[100] flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <div className="absolute top-4 right-4 flex gap-3 z-[110]">
            <a 
              href={lightboxUrl} 
              target="_blank" 
              rel="noreferrer" 
              className="p-2 bg-slate-900 border border-white/10 rounded-full hover:bg-slate-800 text-slate-200 transition-colors"
              title="Open full image"
            >
              <Eye className="h-5 w-5" />
            </a>
            <button
              onClick={() => setLightboxUrl(null)}
              className="p-2 bg-slate-900 border border-white/10 rounded-full hover:bg-slate-800 text-slate-200 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <img
            src={lightboxUrl}
            alt={lightboxName}
            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
          />
        </div>
      )}
    </div>
  );
};
export default DocumentCenterPage;
