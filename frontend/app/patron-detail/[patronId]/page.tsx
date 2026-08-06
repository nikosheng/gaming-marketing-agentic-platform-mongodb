import PatronDetailClient from "./patron-detail-client";

type Props = {
  params: Promise<{ patronId: string }>;
};

export default async function PatronDetailPage({ params }: Props) {
  const { patronId } = await params;
  return <PatronDetailClient patronId={patronId} />;
}
