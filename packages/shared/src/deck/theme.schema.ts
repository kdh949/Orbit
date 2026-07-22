import { z } from "zod";

export const themeColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const themePaletteSchema = z
  .object({
    primary: themeColorSchema.default("#2563eb"),
    secondary: themeColorSchema.default("#7c3aed"),
    surface: themeColorSchema.default("#ffffff"),
    muted: themeColorSchema.default("#f3f4f6"),
    border: themeColorSchema.default("#e5e7eb")
  })
  .default({});

export const themeTypographySchema = z
  .object({
    headingFontFamily: z.string().min(1).default("Inter"),
    bodyFontFamily: z.string().min(1).default("Inter"),
    titleSize: z.number().finite().positive().default(56),
    headingSize: z.number().finite().positive().default(40),
    bodySize: z.number().finite().positive().default(24),
    captionSize: z.number().finite().positive().default(16),
    fallbackFontFamily: z.string().min(1).optional(),
    pptxFontFamily: z.string().min(1).optional(),
    fontWidthFactor: z.number().finite().min(0.8).max(1.4).optional(),
    lineHeight: z.number().finite().min(1).max(1.6).optional()
  })
  .default({});

export const themeShadowSchema = z.object({
  color: themeColorSchema.default("#000000"),
  blur: z.number().finite().nonnegative().default(12),
  offsetX: z.number().finite().default(0),
  offsetY: z.number().finite().default(4),
  opacity: z.number().finite().min(0).max(1).default(0.16)
});

export const themeEffectsSchema = z
  .object({
    borderRadius: z.number().finite().nonnegative().default(8),
    shadow: themeShadowSchema.optional()
  })
  .default({});

export const themeSchema = z.object({
  name: z.string().min(1).default("Default"),
  fontFamily: z.string().min(1).default("Inter"),
  backgroundColor: themeColorSchema.default("#ffffff"),
  textColor: themeColorSchema.default("#111827"),
  accentColor: themeColorSchema.default("#2563eb"),
  palette: themePaletteSchema,
  typography: themeTypographySchema,
  effects: themeEffectsSchema
});

export type ThemePalette = z.infer<typeof themePaletteSchema>;
export type ThemeTypography = z.infer<typeof themeTypographySchema>;
export type ThemeShadow = z.infer<typeof themeShadowSchema>;
export type ThemeEffects = z.infer<typeof themeEffectsSchema>;
export type DeckTheme = z.infer<typeof themeSchema>;
