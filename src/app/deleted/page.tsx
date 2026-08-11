import Link from "next/link";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DeletedPage({ searchParams }: { searchParams: SearchParams }) {
  const parameters = await searchParams;
  const receipt = typeof parameters.receipt === "string" ? parameters.receipt : "not available";

  return (
    <section className="hero">
      <p className="eyebrow">Deletion completed</p>
      <h1>Your application data was deleted.</h1>
      <p className="lede">
        Receipt: <code>{receipt}</code>. The receipt is pseudonymous and does not enumerate deleted
        identifiers.
      </p>
      <Link className="button secondary" href="/">
        Return home
      </Link>
    </section>
  );
}
