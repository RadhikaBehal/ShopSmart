export type CatalogSearchItem = {
  name: string
  category: string
  seller: string
  price: number
}

const categoryTerms: Record<string, string[]> = {
  Audio: ['audio', 'headphone', 'speaker', 'sound', 'music', 'turntable', 'record'],
  Home: ['home', 'lamp', 'chair', 'living', 'interior', 'table', 'decor'],
  Photography: ['camera', 'photography', 'photo', 'lens'],
  Accessories: ['watch', 'accessory', 'accessories'],
}

const ignoredTerms = new Set([
  'a', 'an', 'and', 'are', 'best', 'budget', 'for', 'find', 'good', 'i', 'in',
  'is', 'it', 'looking', 'me', 'my', 'of', 'on', 'or', 'the', 'to', 'under',
  'with', 'you', 'below', 'less', 'than', 'up', 'under', 'rupees', 'rs', 'inr',
])

export function interpretCatalogQuery(query: string) {
  const normalized = query.toLowerCase()
  const category = Object.entries(categoryTerms).find(([, terms]) => terms.some((term) => normalized.includes(term)))?.[0]
  const budgetMatch = normalized.match(/(?:under|below|up to|less than|budget(?:\s+of)?|₹|rs\.?|inr)\s*₹?\s*([\d,]+)/i)
  const maxPrice = budgetMatch ? Number(budgetMatch[1].replaceAll(',', '')) : undefined
  const categorySynonyms = category ? categoryTerms[category] : []
  const terms = normalized
    .match(/[a-z]+/g)
    ?.map((term) => term.endsWith('s') && term.length > 4 ? term.slice(0, -1) : term)
    .filter((term) => !ignoredTerms.has(term) && !categorySynonyms.includes(term)) ?? []
  return { category, maxPrice, terms: [...new Set(terms)] }
}

export function matchCatalogProducts<T extends CatalogSearchItem>(
  products: T[],
  selectedCategory: string,
  query: string,
) {
  const intent = interpretCatalogQuery(query)
  return products.filter((product) => {
    const category = intent.category ?? selectedCategory
    if (category !== 'Everything' && product.category !== category) return false
    if (intent.maxPrice !== undefined && product.price > intent.maxPrice) return false
    if (intent.terms.length === 0) return true
    const haystack = `${product.name} ${product.category} ${product.seller}`.toLowerCase()
    return intent.terms.some((term) => haystack.includes(term))
  })
}
