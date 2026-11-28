/**
 * The photo queue's queries, over `/api/admin/photos` (Task 33). Decisions
 * go through `useAdminAction`, which re-reads every admin answer and the
 * directory, where an approved photo appears and a rejected one goes.
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { Paged } from "@shared/types/common";
import type { AdminPhoto, PhotoStatus } from "@shared/types/photos";
import { api } from "../../lib/api";
import { ADMIN_PAGE_SIZE } from "./api";

export const adminPhotoKeys = {
  list: (status: PhotoStatus, page: number, size: number) => ["admin", "photos", status, page, size] as const,
};

export function usePhotos(status: PhotoStatus, page = 1, size = ADMIN_PAGE_SIZE) {
  return useQuery({
    queryKey: adminPhotoKeys.list(status, page, size),
    queryFn: () => api<Paged<AdminPhoto>>(`/admin/photos?status=${status}&page=${page}&size=${size}`),
    placeholderData: keepPreviousData,
  });
}
