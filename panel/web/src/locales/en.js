// English translations, one file per area in ./en/. Keys are the French source strings used in the code.
const modules = import.meta.glob('./en/*.js', { eager: true });

export default Object.assign({}, ...Object.values(modules).map((m) => m.default));
