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
