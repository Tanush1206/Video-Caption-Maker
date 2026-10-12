import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge, told about the type scale in tailwind.config.ts. Without
 * this it reads `text-body-md` as a text *colour* and drops whichever colour
 * came before it: a primary button (`text-primary-foreground … text-body-md`)
 * lost its white label and fell back to the body colour.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["h1", "h2", "body-md", "body-sm", "label-caps", "mono-data", "mono-data-sm"] },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
