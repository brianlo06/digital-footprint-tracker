# Search providers

**Purpose:** discover public web candidates through an authorized search API or user-submitted results.  
**Inputs:** minimal verified identifier reference, approved query type, locale, strict result/page/cost bounds. Raw values are decrypted only for an authorized run.  
**Expected outputs:** web-mention/public-document candidates with URL, title, bounded snippet summary, external ID, retrieval time, evidence and coverage.  
**Potential providers:** current legitimate full-web search APIs, licensed SERP services after supply-chain review, and user-submitted links. Bing’s legacy API and Google Custom Search cannot be assumed available.  
**Privacy concerns:** provider learns the personal query; result snippets can expose third parties; caching creates a new PII corpus.  
**ToS concerns:** intended use, display/attribution, caching/retention, query automation, derived data, geographic limits. No search-page scraping or control bypass.  
**Failure modes:** rate/price change, retirement, regional gaps, duplicates, stale results, poisoned links, partial pagination, false identity matches.  
**Future implementation notes:** one provider maximum for MVP experimentation, verified/cost-gated, conservative confidence, hard kill switch, raw payload ephemeral, synthetic contract fixtures first.
