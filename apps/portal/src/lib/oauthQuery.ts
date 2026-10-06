// The query string exactly as the browser loaded the page. The router rewrites
// repeated keys (`ba_param=a&ba_param=b` becomes `ba_param=["a","b"]`) right
// after load, which breaks the server's signature on the OAuth query. Imported
// first in main.tsx so it is read before that happens.
export const initialQuery = window.location.search.slice(1);
