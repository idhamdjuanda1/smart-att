import SmartAttApp from "@/app/components/SmartAttApp";
import type { Metadata } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://smart-att.web.id";
const FIREBASE_PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "smart-att-90ef9";

type FirestoreDocument = { fields?: Record<string, { stringValue?: string; booleanValue?: boolean; integerValue?: string; doubleValue?: number }> };

function field(document: FirestoreDocument, key: string) {
  const value = document.fields?.[key];
  if (typeof value?.stringValue === "string") return value.stringValue;
  if (typeof value?.booleanValue === "boolean") return value.booleanValue;
  if (typeof value?.integerValue === "string") return Number(value.integerValue);
  if (typeof value?.doubleValue === "number") return value.doubleValue;
  return undefined;
}

async function getPublishedArticle(slug: string) {
  try {
    const response = await fetch(`https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/articles/${encodeURIComponent(slug)}`, { next: { revalidate: 60 } });
    if (!response.ok) return null;
    const document = await response.json() as FirestoreDocument;
    if (field(document, "published") !== true) return null;
    return {
      title: String(field(document, "title") ?? "Artikel Pendidikan"),
      excerpt: String(field(document, "excerpt") ?? "Artikel praktis untuk guru dan sekolah."),
      coverKey: typeof field(document, "coverKey") === "string" ? String(field(document, "coverKey")) : "",
    };
  } catch { return null; }
}

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }): Promise<Metadata> {
  const segments = (await params).slug ?? [];
  const slug = segments[0] === "articles" ? segments[1] : undefined;
  if (!slug) return {};
  const article = await getPublishedArticle(slug);
  if (!article) return {};
  const image = article.coverKey ? `${SITE_URL}/api/storage/article/${encodeURIComponent(article.coverKey)}` : `${SITE_URL}/logo.png`;
  const url = `${SITE_URL}/articles/${encodeURIComponent(slug)}`;
  return {
    metadataBase: new URL(SITE_URL),
    title: `${article.title} | SMART-ATT`,
    description: article.excerpt,
    alternates: { canonical: url },
    openGraph: { type: "article", url, title: article.title, description: article.excerpt, siteName: "SMART-ATT", images: [{ url: image, width: 1200, height: 630, alt: article.title }] },
    twitter: { card: "summary_large_image", title: article.title, description: article.excerpt, images: [image] },
  };
}

export default function CatchAllPage() {
  return <SmartAttApp />;
}
