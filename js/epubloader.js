export async function loadEpub(file) {
  const book = ePub(file);
  await book.ready;

  const metadata = await book.loaded.metadata;

  return {
    id: crypto.randomUUID(),
    title: metadata.title || "Unknown title",
    author: metadata.creator || "Unknown author",
    file,
    addedAt: new Date()
  };
}