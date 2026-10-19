/**
 * Classic debounce: returns a function that delays calling `fn` until `delay`
 * ms have passed since the last call. Call `.cancel()` to drop a pending call
 * (e.g. when clearing the input or unmounting).
 */
export function debounce(fn, delay = 400) {
  let timer;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}
