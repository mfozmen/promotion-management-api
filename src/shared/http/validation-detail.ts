/** One thing wrong with a request. The envelope returns the path as given and
 *  truncates the message, so whoever builds one owes the caller their own field
 *  names and nothing read from a row. */
export interface ValidationDetail {
  path: string;
  message: string;
}
