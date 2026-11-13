import * as mod from 'node:module';
const MSG = 'keytar disabled — file sessions only';
if (mod.registerHooks) {
  mod.registerHooks({
    resolve(s, c, next) {
      if (s === '@github/keytar') throw new Error(MSG);
      return next(s, c);
    },
  });
} else {
  mod.register(
    'data:text/javascript,' +
      encodeURIComponent(
        `export async function resolve(s,c,next){if(s==='@github/keytar')throw new Error(${JSON.stringify(MSG)});return next(s,c);}`,
      ),
  );
}
