/** External embeds require an exact HTTPS provider host, never a URL substring. */
export function actorEmbedUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return;
    if (
      [
        "youtube.com",
        "www.youtube.com",
        "youtu.be",
        "www.youtube-nocookie.com",
      ].includes(url.hostname)
    ) {
      const id =
        url.hostname === "youtu.be"
          ? url.pathname.slice(1)
          : url.pathname.startsWith("/embed/")
            ? url.pathname.slice(7)
            : url.searchParams.get("v");
      return id && /^[a-zA-Z0-9_-]+$/.test(id)
        ? `https://www.youtube-nocookie.com/embed/${id}`
        : undefined;
    }
    if (
      ["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(url.hostname)
    ) {
      const id = url.pathname.split("/").filter(Boolean).at(-1);
      return id && /^\d+$/.test(id)
        ? `https://player.vimeo.com/video/${id}`
        : undefined;
    }
  } catch {
    /* Invalid URLs render as ordinary content, never an iframe. */
  }
}
