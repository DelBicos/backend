import { SubCategoryModel } from "../../../../models/Subcategory";
import { CategoryModel } from "../../../../models/Category";
import { normalizeText } from "../../../../utils/nlp.util";
import type { ActiveTaxonomy, BotCatalogService, LexicalMatch, TaxonomyMatch } from "./types";
import { calculateLexicalMatch } from "./ranking";

/** findAll opcional: mocks antigos de teste nao o definem. */
interface ModelLoader<Row> {
  findAll?: (options: object) => Promise<Row[]>;
}
interface CategoryRow {
  id: number;
  title: string;
}
interface SubcategoryRow extends CategoryRow {
  category_id?: number;
  Category?: CategoryRow;
}

export function taxonomyFromServices(services: BotCatalogService[]): ActiveTaxonomy[] {
  const entries = new Map<string, ActiveTaxonomy>();
  for (const service of services) {
    const subcategory = service.Subcategory;
    const category = subcategory?.Category;
    if (subcategory?.id != null) {
      entries.set(`subcategory:${subcategory.id}`, {
        kind: "subcategory",
        id: subcategory.id,
        title: subcategory.title,
        categoryId: category?.id,
        categoryTitle: category?.title,
      });
    }
    if (category?.id != null) {
      entries.set(`category:${category.id}`, {
        kind: "category",
        id: category.id,
        title: category.title,
      });
    }
  }
  return Array.from(entries.values());
}

export async function loadActiveTaxonomy(services: BotCatalogService[]): Promise<ActiveTaxonomy[]> {
  // O guard mantém os testes/mocks antigos compatíveis. Em execução normal,
  // a taxonomia vem de uma consulta própria e inclui itens ainda sem serviços.
  const findSubcategories = (SubCategoryModel as unknown as ModelLoader<SubcategoryRow>).findAll;
  const findCategories = (CategoryModel as unknown as ModelLoader<CategoryRow>).findAll;
  if (typeof findSubcategories !== "function") {
    return taxonomyFromServices(services);
  }

  const [subcategories, categories] = await Promise.all([
    findSubcategories.call(SubCategoryModel, {
      where: { active: true },
      attributes: ["id", "title", "category_id"],
      include: [
        {
          model: CategoryModel,
          as: "Category",
          attributes: ["id", "title"],
          required: true,
          where: { active: true },
        },
      ],
    }),
    typeof findCategories === "function"
      ? findCategories.call(CategoryModel, {
          where: { active: true },
          attributes: ["id", "title"],
        })
      : Promise.resolve([]),
  ]);

  const entries = new Map<string, ActiveTaxonomy>();
  for (const subcategory of subcategories) {
    const category = subcategory.Category;
    entries.set(`subcategory:${subcategory.id}`, {
      kind: "subcategory",
      id: subcategory.id,
      title: subcategory.title,
      categoryId: category?.id ?? subcategory.category_id,
      categoryTitle: category?.title,
    });
    if (category?.id != null) {
      entries.set(`category:${category.id}`, {
        kind: "category",
        id: category.id,
        title: category.title,
      });
    }
  }
  for (const category of categories) {
    entries.set(`category:${category.id}`, {
      kind: "category",
      id: category.id,
      title: category.title,
    });
  }
  return Array.from(entries.values());
}

export function findUniqueTaxonomyMatch(
  searchTokens: string[],
  taxonomy: ActiveTaxonomy[],
): TaxonomyMatch | null {
  const ranked = taxonomy
    .map((entry) => ({
      entry,
      match: calculateLexicalMatch(searchTokens, [entry.title]),
    }))
    .filter(
      (item): item is { entry: ActiveTaxonomy; match: LexicalMatch } =>
        item.match !== null,
    )
    .sort(
      (left, right) =>
        right.match.coverage - left.match.coverage ||
        right.match.score - left.match.score ||
        left.entry.title.localeCompare(right.entry.title),
    );

  const best = ranked[0];
  if (!best) return null;
  const competingMatches = ranked.filter(
    (item) =>
      item.match.coverage === best.match.coverage &&
      Math.abs(item.match.score - best.match.score) < 0.02,
  );
  return competingMatches.length === 1
    ? { entry: best.entry, match: best.match }
    : null;
}

export function servicesForTaxonomy(services: BotCatalogService[], taxonomy: ActiveTaxonomy): BotCatalogService[] {
  if (taxonomy.kind === "subcategory") {
    return services.filter(
      (service) =>
        service.subcategory_id === taxonomy.id ||
        normalizeText(service.Subcategory?.title ?? "") ===
          normalizeText(taxonomy.title),
    );
  }

  return services.filter(
    (service) =>
      service.Subcategory?.Category?.id === taxonomy.id ||
      normalizeText(service.Subcategory?.Category?.title ?? "") ===
        normalizeText(taxonomy.title),
  );
}

