# Redesign component registry

| Foundation                    | Existing owner and consumers                                                                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout and theme              | `src/styles/tokens.css`, `src/styles/product.css`, `src/app-system.css`, and `src/cohesion.css` provide shared style layers. Feature styles should own feature-specific layout.        |
| Status and overlays           | `src/components/Primitives.tsx` owns `Status`, `Dialog`, and `Drawer`. A1 reuses `Status` and adds a layout class for the status group within `StudentPortalSchedule.tsx`.             |
| Navigation and record context | `AppShell.tsx`, `StudentPortal.tsx`, `useWorkspaceLocation.ts`, and `recordLinks.ts` own navigation and return context. Lesson History uses its existing link and `portalContextLink`. |
| Writing                       | `WritingArea.tsx` owns the expanding textarea. `StudentWorkspace.tsx` owns the current rich notes composer.                                                                            |
| Files and resources           | `src/data/uploads.ts` owns the authenticated upload path. `LessonFiles.tsx` and the library features handle attachment and selection workflows.                                        |
| Browser fixtures              | `e2e/candidate-local/fixture.ts` supplies isolated roles and responses. The A1 spec uses its existing lesson rows and sets a masked Household finance permission.                      |
