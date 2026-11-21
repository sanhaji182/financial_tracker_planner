import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FileText,
  UploadCloud,
  Trash2,
  Download,
  Link as LinkIcon,
  Search,
  Tag as TagIcon,
  Eye,
  X,
  AlertCircle,
  Loader2,
  Layers,
  Database,
} from 'lucide-react';
import documentsService, { type Document } from '../services/documents';
import { useAssets } from '../hooks/useAssets';
import { useDebts } from '../hooks/useDebts';
import { transactionsService, type Transaction } from '../services/transactions';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { CardSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { useAuthStore } from '../stores/authStore';
import { toast } from '../stores/useToastStore';

export const DocumentCenterPage: React.FC = () => {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'owner';

  const [documents, setDocuments] = useState<Document[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEntityType, setSelectedEntityType] = useState('');
  const [selectedTag, setSelectedTag] = useState('');

  const [dragActive, setDragActive] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [documentToLink, setDocumentToLink] = useState<Document | null>(null);
  const [linkEntityType, setLinkEntityType] = useState<'transaction' | 'asset' | 'debt'>('transaction');
  const [linkEntityId, setLinkEntityId] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [isLinking, setIsLinking] = useState(false);

  const [docToDelete, setDocToDelete] = useState<Document | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { data: assets } = useAssets();
  const { data: debts } = useDebts();
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxName, setLightboxName] = useState('');
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!lightboxUrl) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLightboxUrl(null);
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [lightboxUrl]);

  const fetchDocuments = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const data = await documentsService.getDocuments(
        selectedEntityType || undefined,
        selectedTag || undefined
      );
      setDocuments(Array.isArray(data) ? data : []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengambil daftar dokumen');
    } finally {
      setIsLoading(false);
    }
  }, [selectedEntityType, selectedTag]);

  useEffect(() => {
    void fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    const fetchTransactions = async () => {
      try {
        const res = await transactionsService.getTransactions({ page: 1, page_size: 100 });
        setTransactions(Array.isArray(res?.data) ? res.data : []);
      } catch {
        // Optional dropdown data
      }
    };
    void fetchTransactions();
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
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
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
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      setUploadError('Hanya mendukung format PDF, JPG, PNG, atau JPEG.');
      return;
    }
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

      toast.success('Dokumen berhasil diunggah', uploadFile.name);
      setUploadFile(null);
      setUploadDescription('');
      setUploadTags('');
      await fetchDocuments();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Gagal mengunggah dokumen';
      setUploadError(msg);
      toast.error('Upload gagal', msg);
    } finally {
      setIsUploading(false);
    }
  };

  const confirmDelete = async () => {
    if (!docToDelete) return;
    setIsDeleting(true);
    try {
      await documentsService.deleteDocument(docToDelete.id);
      toast.success('Dokumen berhasil dihapus', docToDelete.file_name);
      setDocToDelete(null);
      await fetchDocuments();
    } catch (err) {
      toast.error('Gagal menghapus dokumen', err instanceof Error ? err.message : undefined);
    } finally {
      setIsDeleting(false);
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
      toast.success('Dokumen berhasil ditautkan');
      setLinkModalOpen(false);
      await fetchDocuments();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message || 'Gagal menghubungkan dokumen';
      setLinkError(msg);
    } finally {
      setIsLinking(false);
    }
  };

  const allTags = Array.from(new Set(documents.flatMap((doc) => doc.tags || [])));

  const filteredDocuments = documents.filter(
    (doc) =>
      doc.file_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (doc.description && doc.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  };

  const isImage = (type: string) => type.startsWith('image/');

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Document Center"
        subtitle="Penyimpanan struk, sertifikat aset, bukti cicilan, dan berkas keuangan keluarga."
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {isOwner && (
          <div className="lg:col-span-4 space-y-4">
            <Card title="Unggah Dokumen" subtitle="PDF, JPG, atau PNG hingga 10MB">
              <div className="space-y-4">
                <div
                  onDragEnter={handleDrag}
                  onDragOver={handleDrag}
                  onDragLeave={handleDrag}
                  onDrop={handleDrop}
                  className={`relative border-2 border-dashed rounded-2xl p-6 text-center transition-all ${
                    dragActive
                      ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30'
                      : 'border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-slate-600 bg-slate-50/60 dark:bg-slate-800/40'
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
                    <div className="mx-auto w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-500/15 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                      <UploadCloud className="h-6 w-6" />
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                      Tarik file ke sini, atau{' '}
                      <span className="text-indigo-600 dark:text-indigo-400 font-semibold">
                        pilih berkas
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      PDF, JPG, JPEG, atau PNG (Maks 10MB)
                    </div>
                  </label>
                </div>

                {uploadError && (
                  <div className="flex items-center gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200/80 dark:border-rose-900/50 p-3 text-xs text-rose-700 dark:text-rose-400">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{uploadError}</span>
                  </div>
                )}

                {uploadFile && (
                  <form onSubmit={handleUploadSubmit} className="space-y-3">
                    <div className="rounded-xl bg-slate-100 dark:bg-slate-800 p-2.5 flex items-center justify-between text-xs text-slate-700 dark:text-slate-200">
                      <span className="truncate max-w-[200px] font-semibold">{uploadFile.name}</span>
                      <button
                        type="button"
                        onClick={() => setUploadFile(null)}
                        className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                        Keterangan
                      </label>
                      <input
                        type="text"
                        value={uploadDescription}
                        onChange={(e) => setUploadDescription(e.target.value)}
                        placeholder="Deskripsi berkas..."
                        className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                        Tag (pisahkan koma)
                      </label>
                      <input
                        type="text"
                        value={uploadTags}
                        onChange={(e) => setUploadTags(e.target.value)}
                        placeholder="struk, aset, pajak"
                        className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <Button type="submit" className="w-full" disabled={isUploading}>
                      {isUploading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Mengunggah...
                        </>
                      ) : (
                        'Simpan Berkas'
                      )}
                    </Button>
                  </form>
                )}
              </div>
            </Card>
          </div>
        )}

        <div className={isOwner ? 'lg:col-span-8 space-y-4' : 'lg:col-span-12 space-y-4'}>
          {/* Filter Controls */}
          <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedEntityType}
                onChange={(e) => setSelectedEntityType(e.target.value)}
                className="h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                <option value="">Semua Dokumen</option>
                <option value="transaction">Terhubung Transaksi</option>
                <option value="asset">Terhubung Aset</option>
                <option value="debt">Terhubung Utang</option>
                <option value="bill">Terhubung Tagihan</option>
              </select>

              {selectedTag && (
                <span className="inline-flex items-center gap-1 bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 ring-1 ring-inset ring-indigo-600/20 text-xs px-2.5 py-1 rounded-full font-semibold">
                  Tag: {selectedTag}
                  <button
                    type="button"
                    onClick={() => setSelectedTag('')}
                    className="hover:text-indigo-900 dark:hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              )}
            </div>

            <div className="relative max-w-xs w-full">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nama berkas atau keterangan..."
                className="w-full h-9 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800 pl-9 pr-3 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900"
              />
            </div>
          </Card>

          {allTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs font-semibold text-slate-500 flex items-center gap-1 mr-1">
                <TagIcon className="h-3.5 w-3.5" /> Tag:
              </span>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setSelectedTag(tag === selectedTag ? '' : tag)}
                  className={`text-xs font-medium px-2.5 py-1 rounded-full transition-all border ${
                    tag === selectedTag
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-indigo-300'
                  }`}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((n) => (
                <CardSkeleton key={n} />
              ))}
            </div>
          ) : errorMsg ? (
            <Card className="p-8 text-center text-rose-600 dark:text-rose-400 text-sm font-medium">
              {errorMsg}
            </Card>
          ) : filteredDocuments.length === 0 ? (
            <EmptyState
              title="Tidak ada dokumen ditemukan"
              description="Belum ada berkas yang diunggah atau sesuai dengan filter pencarian Anda."
              icon={FileText}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredDocuments.map((doc) => (
                <Card key={doc.id} hoverable className="p-4 flex flex-col justify-between space-y-4">
                  <div>
                    <div className="h-36 rounded-xl bg-slate-100 dark:bg-slate-800/80 overflow-hidden relative group border border-slate-200/70 dark:border-slate-700/60 flex items-center justify-center">
                      {isImage(doc.file_type) ? (
                        <>
                          <img
                            src={previewUrls[doc.id] || ''}
                            alt={doc.file_name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setLightboxUrl(previewUrls[doc.id] || null);
                              setLightboxName(doc.file_name);
                            }}
                            className="absolute inset-0 bg-slate-900/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                          >
                            <Eye className="h-5 w-5 mr-1.5" />
                            <span className="text-xs font-semibold">Pratinjau</span>
                          </button>
                        </>
                      ) : (
                        <div className="text-center p-4">
                          <FileText className="h-10 w-10 text-indigo-600 dark:text-indigo-400 mx-auto mb-2" />
                          <Badge variant="transfer">
                            {(doc.file_type.split('/')[1] || 'PDF').toUpperCase()}
                          </Badge>
                        </div>
                      )}
                    </div>

                    <div className="mt-3 space-y-1">
                      <div className="flex justify-between items-start gap-2">
                        <h4
                          className="text-sm font-semibold text-slate-900 dark:text-white truncate flex-1"
                          title={doc.file_name}
                        >
                          {doc.file_name}
                        </h4>
                        <span className="text-[11px] text-slate-400 font-medium shrink-0">
                          {formatBytes(doc.file_size)}
                        </span>
                      </div>
                      {doc.description && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                          {doc.description}
                        </p>
                      )}

                      {doc.linked_entity_type && (
                        <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 ring-1 ring-inset ring-emerald-600/20 px-2 py-0.5 rounded-full mt-1">
                          <Layers className="h-3 w-3" />
                          Terhubung:{' '}
                          {doc.linked_entity_type === 'transaction'
                            ? 'Transaksi'
                            : doc.linked_entity_type === 'asset'
                            ? 'Aset'
                            : doc.linked_entity_type === 'debt'
                            ? 'Utang'
                            : doc.linked_entity_type}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                    {doc.tags && doc.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {doc.tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-md"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void documentsService.downloadDocument(doc.id, doc.file_name)}
                        className="flex-1"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Unduh
                      </Button>

                      {isOwner && (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleOpenLinkModal(doc)}
                            className="flex-1"
                          >
                            <LinkIcon className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                            Hubungkan
                          </Button>

                          <button
                            type="button"
                            onClick={() => setDocToDelete(doc)}
                            className="p-2 rounded-xl border border-rose-200 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                            title="Hapus Dokumen"
                          >
                            <Trash2 className="h-4 w-4" />
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
        title="Hubungkan Dokumen ke Entitas"
        footerActions={
          <>
            <Button variant="ghost" onClick={() => setLinkModalOpen(false)} disabled={isLinking}>
              Batal
            </Button>
            <Button onClick={handleLinkSubmit} disabled={isLinking || !linkEntityId} isLoading={isLinking}>
              Hubungkan Berkas
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {linkError && (
            <div className="flex items-center gap-2 rounded-xl bg-rose-50 dark:bg-rose-950/30 p-3 text-xs text-rose-700 dark:text-rose-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{linkError}</span>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5 mb-1.5">
              <Database className="h-3.5 w-3.5" /> Tipe Entitas
            </label>
            <select
              value={linkEntityType}
              onChange={(e) => {
                setLinkEntityType(e.target.value as 'transaction' | 'asset' | 'debt');
                setLinkEntityId('');
              }}
              className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-slate-100"
            >
              <option value="transaction">Transaksi Keuangan</option>
              <option value="asset">Aset Fisik / Likuid</option>
              <option value="debt">Utang & Cicilan</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block mb-1.5">
              Pilih Item
            </label>
            <select
              value={linkEntityId}
              onChange={(e) => setLinkEntityId(e.target.value)}
              className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-slate-100"
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
                    {a.name} (Rp {a.current_value.toLocaleString('id-ID')})
                  </option>
                ))}

              {linkEntityType === 'debt' &&
                debts?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} (Sisa: Rp {d.outstanding_balance.toLocaleString('id-ID')})
                  </option>
                ))}
            </select>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(docToDelete)}
        onClose={() => setDocToDelete(null)}
        onConfirm={confirmDelete}
        title="Hapus Dokumen"
        description={`Apakah Anda yakin ingin menghapus "${docToDelete?.file_name || ''}"? File fisik juga akan dihapus permanen.`}
        confirmLabel="Ya, Hapus"
        cancelLabel="Batal"
        variant="danger"
        isLoading={isDeleting}
      />

      {lightboxUrl && (() => {
        const lightbox = (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={lightboxName || 'Pratinjau Dokumen'}
            className="fixed inset-0 bg-slate-950/85 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-backdrop-in"
            onClick={() => setLightboxUrl(null)}
          >
            <div className="absolute top-4 right-4 flex gap-2 z-[110]">
              <a
                href={lightboxUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="p-2.5 bg-white/90 hover:bg-white rounded-full text-slate-800 shadow-lg transition-colors"
                title="Buka di tab baru"
              >
                <Eye className="h-5 w-5" />
              </a>
              <button
                type="button"
                onClick={() => setLightboxUrl(null)}
                className="p-2.5 bg-white/90 hover:bg-white rounded-full text-slate-800 shadow-lg transition-colors"
                title="Tutup pratinjau"
                aria-label="Tutup pratinjau"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <img
              src={lightboxUrl}
              alt={lightboxName}
              onClick={(e) => e.stopPropagation()}
              className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-2xl"
            />
          </div>
        );
        return typeof document !== 'undefined' ? createPortal(lightbox, document.body) : lightbox;
      })()}
    </div>
  );
};

export default DocumentCenterPage;
