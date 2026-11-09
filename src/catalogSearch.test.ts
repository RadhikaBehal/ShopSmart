import { describe, expect, it } from 'vitest'
import { interpretCatalogQuery, matchCatalogProducts, type CatalogSearchItem } from './catalogSearch'

const catalog: CatalogSearchItem[] = [
  { name: 'Ember Bluetooth Speaker', category: 'Audio', seller: 'Good Sound Co.', price: 8499 },
  { name: 'Arc Table Light', category: 'Home', seller: 'Form & Field', price: 12400 },
  { name: 'Everyday Camera Bag', category: 'Photography', seller: 'Field Notes', price: 6400 },
]

describe('catalog intent filters', () => {
  it('extracts category, query terms, and an INR budget from natural language', () => {
    expect(interpretCatalogQuery('a good audio speaker under ₹8,500')).toEqual({
      category: 'Audio',
      maxPrice: 8500,
      terms: [],
    })
  })

  it('matches relevant products and applies a budget cap', () => {
    expect(matchCatalogProducts(catalog, 'Everything', 'a lamp under ₹10,000').map((item) => item.name))
      .toEqual([])
    expect(matchCatalogProducts(catalog, 'Everything', 'audio speaker under ₹9,000').map((item) => item.name))
      .toEqual(['Ember Bluetooth Speaker'])
    expect(matchCatalogProducts(catalog, 'Everything', 'lamp under ₹13,000').map((item) => item.name))
      .toEqual(['Arc Table Light'])
  })
})
