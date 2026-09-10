# Opal heart fan tier assets

Approved badge family: Bronze 1, Silver 2, Gold 3, Platinum 4, Diamond 1.
Each stage is represented by the number of pearls inside the star.

The top-level PNGs are 1024 x 1024. The 512, 256, 128 and 64 directories contain matching exports at those sizes. All 55 images use a real RGBA transparent background. Assets share the same body within each tier; pearl placement is centered and mirrored precisely.

`manifest.json` maps tiers and stages to image URLs. It defines no score thresholds. Runtime stage selection and display integration are pending.

Validated: file dimensions, alpha channel, transparent borders, identical within-tier silhouettes, centered single pearls and mirrored multiple pearls; rendered on light and dark backgrounds at 128px and 64px.
