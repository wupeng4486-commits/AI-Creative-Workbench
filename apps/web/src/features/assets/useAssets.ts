import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.ts";
import type { AssetView } from "../../lib/types.ts";

export interface AssetFilters {
  search: string;
  type: string;
  origin: string;
  tag: string;
  catalog: string;
  filesOnly?: string;
}

export interface AssetsResponse {
  datasetId: string;
  items: AssetView[];
  tags: string[];
}

export function useAssets(filters: AssetFilters) {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.type) params.set("type", filters.type);
  if (filters.origin) params.set("origin", filters.origin);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.catalog) params.set("catalog", filters.catalog);
  if (filters.filesOnly) params.set("filesOnly", filters.filesOnly);
  const query = params.toString();
  return useQuery({
    queryKey: ["assets", query],
    queryFn: () => api<AssetsResponse>(`/api/assets${query ? `?${query}` : ""}`),
  });
}

export function useAsset(id: string | undefined) {
  return useQuery({
    queryKey: ["asset", id],
    queryFn: () =>
      api<{ datasetId: string; asset: AssetView; references: Array<{ id: string; label: string; href: string }> }>(
        `/api/assets/${id}`,
      ),
    enabled: Boolean(id),
  });
}

export function useAssetMutations() {
  const client = useQueryClient();
  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["assets"] });
    void client.invalidateQueries({ queryKey: ["home"] });
    void client.invalidateQueries({ queryKey: ["search"] });
  };
  const upload = useMutation({
    mutationFn: async (input: { file: File; tags: string; origin: "owned" | "shared"; notes: string }) => {
      const form = new FormData();
      form.append("tags", input.tags);
      form.append("origin", input.origin);
      form.append("notes", input.notes);
      form.append("file", input.file);
      return api<{ asset: AssetView }>("/api/assets/import", { method: "POST", body: form });
    },
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: (input: {
      id: string;
      name?: string;
      tags?: string[];
      notes?: string;
      origin?: "owned" | "shared";
    }) =>
      api<{ asset: AssetView }>(`/api/assets/${input.id}`, {
        method: "PATCH",
        body: input,
      }),
    onSuccess: (_data, variables) => {
      void client.invalidateQueries({ queryKey: ["asset", variables.id] });
      invalidate();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/assets/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  return { upload, update, remove };
}
