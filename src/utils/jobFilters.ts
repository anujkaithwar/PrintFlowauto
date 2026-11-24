import type { PrintJob } from '../types';

export type JobStatusFilter = 'all' | 'pending' | 'printing' | 'completed' | 'whatsapp';
export type FileTypeFilter = 'all' | 'pdf' | 'image' | 'word';
export type JobSortBy = 'newest' | 'status' | 'fileType';
export type FileCategory = 'pdf' | 'image' | 'word' | 'other';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic']);
const WORD_EXTENSIONS = new Set(['.doc', '.docx', '.rtf', '.odt']);

export function getJobFileCategory(
  job: Pick<PrintJob, 'fileExtension' | 'mimeType' | 'originalFilename'>
): FileCategory {
  const ext = (job.fileExtension || '').toLowerCase();
  const mime = (job.mimeType || '').toLowerCase();
  const name = (job.originalFilename || '').toLowerCase();

  if (ext === '.pdf' || mime === 'application/pdf' || name.endsWith('.pdf')) {
    return 'pdf';
  }
  if (
    IMAGE_EXTENSIONS.has(ext) ||
    mime.startsWith('image/') ||
    /\.(jpg|jpeg|png|webp|gif|bmp|heic)$/i.test(name)
  ) {
    return 'image';
  }
  if (
    WORD_EXTENSIONS.has(ext) ||
    mime.includes('wordprocessingml') ||
    mime === 'application/msword' ||
    /\.(doc|docx|rtf|odt)$/i.test(name)
  ) {
    return 'word';
  }
  return 'other';
}

export function getStatusBucket(job: PrintJob): 'pending' | 'printing' | 'completed' | 'other' {
  if (job.printStatus === 'awaiting_payment' || job.printStatus === 'queued') {
    return 'pending';
  }
  if (job.printStatus === 'printing') {
    return 'printing';
  }
  if (job.printStatus === 'completed') {
    return 'completed';
  }
  return 'other';
}

const STATUS_SORT_ORDER: Record<string, number> = {
  awaiting_payment: 0,
  queued: 1,
  printing: 2,
  completed: 3,
  error: 4,
  cancelled: 5,
};

const FILE_TYPE_SORT_ORDER: Record<FileCategory, number> = {
  pdf: 0,
  image: 1,
  word: 2,
  other: 3,
};

export function filterAndSortJobs(
  jobs: PrintJob[],
  options: {
    statusFilter: JobStatusFilter;
    fileTypeFilter: FileTypeFilter;
    sortBy?: JobSortBy;
    searchQuery?: string;
  }
): PrintJob[] {
  const { statusFilter, fileTypeFilter, sortBy = 'newest', searchQuery = '' } = options;
  const q = searchQuery.trim().toLowerCase();

  const filtered = jobs.filter((job) => {
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'whatsapp' && job.source === 'whatsapp') ||
      (statusFilter === 'pending' && getStatusBucket(job) === 'pending') ||
      (statusFilter === 'printing' && job.printStatus === 'printing') ||
      (statusFilter === 'completed' && job.printStatus === 'completed');

    if (!matchesStatus) return false;

    if (fileTypeFilter !== 'all' && getJobFileCategory(job) !== fileTypeFilter) {
      return false;
    }

    if (q) {
      const matchesSearch =
        job.code.toLowerCase().includes(q) ||
        job.originalFilename.toLowerCase().includes(q) ||
        job.customerName.toLowerCase().includes(q) ||
        job.shopName.toLowerCase().includes(q) ||
        job.customerPhone.toLowerCase().includes(q);
      if (!matchesSearch) return false;
    }

    return true;
  });

  if (sortBy === 'newest') {
    return filtered;
  }

  return [...filtered].sort((a, b) => {
    if (sortBy === 'status') {
      const diff = (STATUS_SORT_ORDER[a.printStatus] ?? 9) - (STATUS_SORT_ORDER[b.printStatus] ?? 9);
      if (diff !== 0) return diff;
    } else if (sortBy === 'fileType') {
      const diff =
        FILE_TYPE_SORT_ORDER[getJobFileCategory(a)] - FILE_TYPE_SORT_ORDER[getJobFileCategory(b)];
      if (diff !== 0) return diff;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}
