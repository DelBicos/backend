import type { ServiceModel } from "../../../../models/Service";

/**
 * Servico do catalogo como o bot o consulta: modelo + associacoes carregadas
 * (subcategoria/categoria, profissional e avaliacoes).
 */
export type BotCatalogService = ServiceModel & {
  Subcategory?: {
    id?: number;
    title: string;
    Category?: { id?: number; title: string } | null;
  } | null;
  Professional?: {
    description?: string | null;
    User?: { name?: string | null; avatar_uri?: string | null };
    MainAddress?: { city?: string | null; state?: string | null };
  } | null;
  Appointments?: { rating?: number | null }[];
};

export interface LexicalMatch {
  coverage: number;
  score: number;
}

export interface RankedService {
  svc: BotCatalogService;
  score: number;
  coverage: number;
}

export interface ActiveTaxonomy {
  kind: "subcategory" | "category";
  id: number;
  title: string;
  categoryId?: number;
  categoryTitle?: string;
}

export interface ServiceQueryAnalysis {
  tokens: string[];
  semanticQuery: string;
  preferActiveService: boolean;
}

export interface TaxonomyMatch {
  entry: ActiveTaxonomy;
  match: LexicalMatch;
}

