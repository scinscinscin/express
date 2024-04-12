export const removeWrappingSlashes = (str: string) => {
  if (str[0] == "/") str = str.slice(1, str.length);
  else if (str[str.length - 1] == "/") str = str.slice(0, str.length - 1);
  return str;
};
