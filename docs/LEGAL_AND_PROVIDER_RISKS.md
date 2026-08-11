# Legal and Provider Risks

**Status:** Research architecture dated 2026-08-11.  
**Notice:** This is not legal advice. Qualified counsel must review launch jurisdictions, privacy notices, provider contracts, and each integration.

## Decision lens

For every source, record three separate conclusions:

| Question                          | Meaning                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| Technically possible              | a system could retrieve/process it                               |
| Legally/contractually appropriate | law, license, contract, and authority permit the proposed use    |
| Recommended                       | privacy, safety, reliability, and product trust justify doing it |

Public accessibility answers only the first question. `robots.txt` is a technical preference signal, not blanket legal permission or prohibition; it must be considered alongside terms, copyright/database rights, access controls, privacy law, computer-access law, and user expectations.

## Risk areas

### Scraping and site access

Risks include terms prohibiting automated access, authentication/captcha circumvention, robots directives, IP blocks, trespass/computer-access theories, copyright/database rights, republishing, brittle parsers, personal-data collection, and disproportionate request load. Do not bypass controls or disguise automation. Default to official/licensed APIs, user-supplied URLs, manual verification, or a vetted removal partner. Every scraper proposal needs written legal/ToS review, documented robots behavior, rate/identity policy, kill switch, retention, and change monitoring. The MVP has no scraper.

### API terms

Terms may limit query purposes, caching, display, derived data, model training, geographic use, sublicensing, retention, attribution, and audit. Provider closure and price change are architectural facts: Microsoft retired Bing Search APIs on August 11, 2025, while Google says Custom Search JSON API is closed to new customers and existing users must transition by January 1, 2027. No provider should be a core-domain dependency.

### Privacy and data protection

GDPR can require a lawful basis, transparency even for indirectly obtained/public data, purpose limitation, minimization, accuracy, storage limitation, security, data-subject rights, processor contracts, transfer controls, and possibly a DPIA. Consent is not automatically the best/only basis and can be withdrawn. The CCPA/CPRA, when applicable, adds notice and rights including know, delete, correct, opt out of sale/sharing, and limits for sensitive information. Other US states and countries vary. Determine controller/processor roles and jurisdiction before launch.

### Data broker and public-record handling

Broker aggregation magnifies risk. Opt-out representation may require verified authority and careful disclosure of what is sent. Public records may carry field/use-specific restrictions; do not assume public means reusable. Avoid employment, housing, credit, insurance, eligibility, or background-check uses that may invoke specialized laws such as FCRA. Maintain a broker terms/opt-out method registry with review dates; start with user-assisted workflows.

### Breach data

Use legitimate notification services and metadata only. Never acquire/store leaked passwords, authentication tokens, stealer logs, or breach dumps. Provider acceptable-use, attribution, rate, and notification requirements apply. Exact-email lookup is allowed only after email verification. Advice must distinguish exposed data categories from proof of account compromise and must never ask the user to enter a password.

### Biometric/image concerns

Facial recognition, embeddings, and even similarity processing can trigger biometric laws, consent, retention/destruction schedules, cross-border transfer issues, and severe false-match harms. The MVP prohibits it. Any future image comparison requires separate counsel, DPIA, explicit opt-in, non-biometric alternative, local/on-device analysis preference, deletion guarantees, and no identity decision without the user.

### Deletion and removal claims

The product must honor its own deletion promise across processors/backups and not misrepresent results. “Request submitted” is not “removed”; absence on one rescan is not guaranteed deletion. Preserve evidence of authority/consent only as long as justified.

### AI processing

Sending scraped personal data to an LLM adds a processor, possible international transfer, retention/training terms, automated-profiling concerns, prompt injection, accuracy, and disclosure risk. AI is not a core dependency. Future use requires redaction, contractual no-training/retention controls, purpose limitation, human confirmation, and separation from identity/severity/removal decisions.

## Provider approval checklist

- official current API/partner route and intended use;
- contract/terms, privacy/DPA, attribution, cache/retention, derived-data rights;
- permitted identifier categories, jurisdictions, age restrictions, and user authority;
- security documentation, breach terms, sub-processors, deletion, data location;
- rate limits, unit/cost model, hard budget and kill switch;
- evidence quality, correction/dispute, false-positive behavior;
- prohibited activities and provider-change monitoring owner/date;
- exit plan: adapter removal, user communication, retained data disposition.

## Current primary references

- [Microsoft: Bing Search APIs retired August 11, 2025](https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement)
- [Google: Custom Search JSON API status](https://developers.google.com/custom-search/v1/overview)
- [European Commission: GDPR processing principles](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en)
- [European Commission: erasure overview](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/dealing-requests-individuals/do-we-always-have-delete-personal-data-if-person-asks_en)
- [California DOJ: CCPA overview](https://oag.ca.gov/privacy/ccpa)
- [FTC: data brokers, transparency, and consumer control](https://www.ftc.gov/news-events/news/press-releases/2014/05/ftc-recommends-congress-require-data-broker-industry-be-more-transparent-give-consumers-greater)
- [Have I Been Pwned API v3 acceptable use and rate behavior](https://haveibeenpwned.com/API/V3)

Provider status and law are time-sensitive. Re-verify all conclusions at implementation and before launch.
