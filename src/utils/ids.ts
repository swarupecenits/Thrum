let counter = 0;

/** Short, sortable, collision-safe ids for playlists and other local rows. */
export function newId(prefix = ''): string {
  counter = (counter + 1) % 1296;
  const time = Date.now().toString(36);
  const seq = counter.toString(36).padStart(2, '0');
  const rand = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0');
  return `${prefix}${time}${seq}${rand}`;
}
