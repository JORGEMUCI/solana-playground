import { hasTrailingWhitespace, parse } from "./utils";
import { PgCommon } from "../common";

/** Callback to create the autocomplete candidates based on the given tokens */
type AutocompleteHandler = (tokens: string[], index: number) => string[];

/** Terminal autocomplete functionality */
export class PgAutocomplete {
  /** Autocomplete handlers */
  private _handlers: AutocompleteHandler[];

  constructor(handlers: Array<AutocompleteHandler | object>) {
    this._handlers = handlers.map((handler) => {
      if (typeof handler === "object") {
        return (tokens, index) => {
          // Example:
          // ```ts
          // handler = {
          //   anchor: {
          //     idl: {
          //       init: {},
          //       upgrade: {}
          //     }
          //   }
          // }
          // ```
          //
          // index: 0
          // tokens: []
          // return: ["anchor"]
          //
          // index: 1
          // tokens: ["anchor"]
          // return: ["idl"]
          //
          // index: 2
          // tokens: ["anchor", "idl"]
          // return: ["init", "upgrade"]
          const recursivelyGetCandidates = (obj: any, i = 0): string[] => {
            if (i > index) return [];

            const candidates = [];
            for (const [key, value] of PgCommon.entries(obj)) {
              // Argument values
              if (PgCommon.isInt(key)) {
                // Skip options
                if (tokens.at(i)?.startsWith("-")) continue;

                if (+key === index - i) {
                  const token = tokens[index];
                  const args: string[] = PgCommon.callIfNeeded(value);
                  const filteredArgs = args.filter(
                    (arg) => !token || arg.startsWith(token)
                  );
                  candidates.push(...filteredArgs);
                } else {
                  // Options are also valid after arguments
                  const opts = Object.entries(obj).reduce(
                    (acc, [prop, val]) => {
                      if (prop.startsWith("-")) acc[prop] = val;
                      return acc;
                    },
                    {} as typeof obj
                  );

                  // The completion index for the next option is the sum of `i`
                  // and how many previous arguments exist.
                  //
                  // The calculation below assumes all arguments have been
                  // passed beforehand, which means option completions between
                  // arguments won't work. Supplying options before or after
                  // all arguments work expected.
                  //
                  // TODO: Calculate how many arguments exist properly to make
                  // option completions between arguments work
                  const argAmount = Object.keys(obj).filter(
                    PgCommon.isInt
                  ).length;
                  candidates.push(
                    ...recursivelyGetCandidates(opts, i + argAmount)
                  );
                }
              }
              // Subcommands or options
              else if (!tokens[i] || key.startsWith(tokens[i])) {
                // Current key and doesn't exist previously in tokens
                if (i === index && !tokens.slice(0, i).includes(key)) {
                  candidates.push(key);
                }
                // Next candidates
                if (key === tokens[i]) {
                  const isOpt = key.startsWith("-");
                  if (isOpt) {
                    // Decide the next index based on whether the option takes
                    // in a value
                    const { takeValue } = obj[key];
                    candidates.push(
                      ...recursivelyGetCandidates(
                        obj,
                        takeValue ? i + 2 : i + 1
                      )
                    );
                  } else {
                    // Subcommand
                    candidates.push(...recursivelyGetCandidates(value, i + 1));
                  }
                }
              }
            }
            return candidates;
          };

          return recursivelyGetCandidates(handler);
        };
      }

      return handler;
    });
  }

  /**
   * Get whether there is at least one handler
   *
   * @returns whether there is at least one handler
   */
  hasAnyHandler() {
    return this._handlers.length > 0;
  }

  /**
   * Temporarily set autocomplete handlers to the given handler.
   *
   * @param handler handler to set
   * @param opts handler options:
   * - `append`: whether to append the handler to the existing handlers
   * @returns an object with `restore` callback to restore the handlers
   */
  temporarilySetHandlers(
    handler: AutocompleteHandler,
    opts?: { append?: boolean }
  ) {
    const initialHandlers = this._handlers;
    this._handlers = opts?.append ? [...initialHandlers, handler] : [handler];
    return {
      restore: () => {
        this._handlers = initialHandlers;
      },
    };
  }

  /**
   * Collect the autocomplete canditates from the given input.
   *
   * @param input terminal input
   *  @returns the sorted autocomplete candidates for the given input
   */
  getCandidates(input: string) {
    const tokens = parse(input);
    let index = tokens.length - 1;

    // Empty expressions
    if (!input.trim()) index = 0;
    // Expressions with danging space
    else if (hasTrailingWhitespace(input)) index += 1;

    // Collect all auto-complete candidates from the callbacks
    const candidates = this._handlers.reduce((acc, cb) => {
      try {
        const candidates = cb(tokens, index);
        return acc.concat(candidates);
      } catch (e) {
        console.log("Autocomplete error:", e);
        return acc;
      }
    }, [] as string[]);

    return (
      // Candidates might include duplicates
      PgCommon.toUniqueArray(candidates)
        // Sort for consistent output
        .sort()
        // Only show options when the current token starts with '-'
        .filter((candidate) => {
          return candidate.startsWith("-")
            ? tokens.at(-1)?.startsWith("-")
            : true;
        })
    );
  }
}
