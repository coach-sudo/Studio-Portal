# Redesign component registry

| Foundation                    | Existing owner and consumers                                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout and theme              | `src/styles/tokens.css`, `src/styles/product.css`, `src/app-system.css`, and `src/cohesion.css` provide shared style layers. Feature styles own feature-specific layout.                       |
| Status and overlays           | `src/components/Primitives.tsx` owns `Status`, `Dialog`, and `Drawer`. A1 uses `Status` in the Lesson History row. A2 uses the shared `workflow-content` inset in the package purchase dialog. |
| Navigation and record context | `AppShell.tsx`, `StudentPortal.tsx`, `useWorkspaceLocation.ts`, and `recordLinks.ts` own navigation and return context. Lesson History uses its existing link and `portalContextLink`.         |
| Actor preview                 | `ActorBuilder.css` owns the private Builder scroll container and preview controls. `ActorProfilePreview.css` bounds the private portrait within the preview.                                   |
| Writing                       | `WritingArea.tsx` owns the expanding textarea. `StudentWorkspace.tsx` owns the current rich notes composer.                                                                                    |
| Files and resources           | `src/data/uploads.ts` owns the authenticated upload path. `LessonFiles.tsx` and the library features handle attachment and selection workflows.                                                |
| Browser fixtures              | `e2e/candidate-local/fixture.ts` supplies synthetic lessons, masked Household finance permissions, and package choices. A3 uses the existing local workspace and private draft flow.           |

## Release B extensions

| Shared owner                                    | Extension and pilot consumers                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tokens.css`                                    | Heading and body stacks, line heights, control borders, disabled pairs, and complete dark foreground and surface pairs.                                                  |
| `product.css`                                   | Reference-aligned hierarchy and navigation, responsive record text, pending and disabled controls, validation and focus, overlays, empty states, and motion preferences. |
| `StudioToday.tsx`                               | Existing Up next and today's lesson sections share one responsive layout wrapper and preserve document order.                                                            |
| `ActorBuilder.tsx`, `StudentPortalPayments.tsx` | Existing pending flags expose `aria-busy`; handlers and existing single-flight guards are retained.                                                                      |
| `Primitives.tsx`                                | Existing `Status`, `Section`, `Dialog`, `Drawer`, `PageSkeleton`, and `InlineNotice` continue to own semantics and behavior. Styles extend these primitives.             |
| `ActorProfilePreview.css`                       | Private preview alone stacks the inherited public hero at tablet widths and wraps long titles; public page styles and publication content are preserved.                 |
