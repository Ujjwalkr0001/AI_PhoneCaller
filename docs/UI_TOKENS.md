# UI tokens and reference study

Studied https://outpero.com/ in Chrome at 1440×1000 and 390×844 on 7 November 2026. Local reference captures/computed styles are in ignored `output/playwright/reference-*`; none of its content, assets or code is copied into the product.

Observed: Geist; 16px/24px body; desktop hero 76px/77.52px, weight 600, −3.42px tracking; mobile hero 44.85px, section headings 28px; near-white `rgb(252,252,253)` and near-black `rgb(15,15,20)`. Small controls use 13px/500 weight, pill shapes, 6px internal gaps and 12px horizontal padding. Large input radius is 16px. The page pairs a narrow phone conversation with a structured record, uses quiet outlined chips and wide vertical separation. It also uses purple gradients and marketing decoration, which this product deliberately does not adopt.

Our application tokens: Inter self-hosted; 12/14/16/20/28/40 type scale; weight 600 headings; body 16/1.6. Warm page #FAFAF9, white surfaces, #E7E5E4 borders, #0F172A text, #64748B muted, indigo #4F46E5 for actions/focus. Outcome colours only: green, amber, grey, red. Cards 16px, controls 10px, chips full-radius; 1px borders; one soft floating-drawer shadow. No gradients. 8px spacing grid; content 1120px, form approximately 560px; 32px section gaps. Minimum 44px tap targets; 160ms motion, reduced-motion override.

Existing brand is ElevateBox. Move it into the web `PRODUCT_NAME` configuration, retaining that default. No new brand is introduced. Existing English-only UI has no i18n system; new copy is collected in a strings module, with native-script disclosure preserved.
