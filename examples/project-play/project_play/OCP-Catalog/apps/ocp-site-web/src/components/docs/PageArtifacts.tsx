import type { LoadedPageArtifacts } from '../../content/page-artifacts';
import { docsUiText, resolveLocalizedText, useDocsLocale } from '../../content/i18n';
import { scrollToElementById } from '../../lib/scroll';

type PageArtifactsProps = {
  artifacts: LoadedPageArtifacts;
};

export function PageArtifacts({ artifacts }: PageArtifactsProps) {
  const { locale, text } = useDocsLocale();
  const hasSchema = artifacts.schemaSections.length > 0;
  const hasSchemaPackages = artifacts.schemaPackages.length > 0;
  const hasImplementation = artifacts.implementationRefs.length > 0;
  const hasEndpointExamples = artifacts.endpointExamples.length > 0;

  if (!hasSchema && !hasSchemaPackages && !hasImplementation && !hasEndpointExamples) {
    return null;
  }

  return (
    <div className="mt-12 space-y-8 not-prose">
      {hasSchema && (
        <section>
          <h2
            id="schema-fragments"
            className="text-2xl font-semibold tracking-tight text-slate-900 mb-4"
          >
            {text(docsUiText.schemaFragments)}
          </h2>
          <div className="space-y-5">
            {artifacts.schemaSections.map((section) => (
              <div key={`${section.sourcePath}-${section.title}`} className="rounded-lg border border-slate-200 bg-slate-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 bg-white">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-base font-semibold text-slate-900">
                        {resolveLocalizedText(section.title, locale)}
                      </div>
                      <div className="text-xs uppercase tracking-[0.14em] text-slate-500 mt-1">
                        {section.sourcePath}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => scrollToElementById(section.packageAnchorId)}
                      className="shrink-0 inline-flex items-center rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                    >
                      {text(docsUiText.openFullSchema)}
                    </button>
                  </div>
                  {section.description && (
                    <p className="text-sm text-slate-600 mt-2">
                      {resolveLocalizedText(section.description, locale)}
                    </p>
                  )}
                </div>
                <pre className="m-0 overflow-x-auto bg-slate-950 text-slate-100 text-sm p-4 leading-6">
                  <code>{section.code}</code>
                </pre>
              </div>
            ))}
          </div>
        </section>
      )}

      {hasSchemaPackages && (
        <section>
          <h2
            id="schema-packages"
            className="text-2xl font-semibold tracking-tight text-slate-900 mb-4"
          >
            {text(docsUiText.schemaPackages)}
          </h2>
          <div className="space-y-5">
            {artifacts.schemaPackages.map((schemaPackage) => (
              <div
                key={schemaPackage.sourcePath}
                id={schemaPackage.anchorId}
                className="rounded-lg border border-slate-200 bg-slate-50 overflow-hidden scroll-mt-24"
              >
                <div className="px-4 py-3 border-b border-slate-200 bg-white">
                  <div className="text-base font-semibold text-slate-900">
                    {text(docsUiText.fullSchemaPackage)}
                  </div>
                  <div className="text-xs uppercase tracking-[0.14em] text-slate-500 mt-1">
                    {schemaPackage.sourcePath}
                  </div>
                </div>
                <pre className="m-0 overflow-x-auto bg-slate-950 text-slate-100 text-sm p-4 leading-6">
                  <code>{schemaPackage.code}</code>
                </pre>
              </div>
            ))}
          </div>
        </section>
      )}

      {hasEndpointExamples && (
        <section>
          <h2
            id="api-endpoint-examples"
            className="text-2xl font-semibold tracking-tight text-slate-900 mb-4"
          >
            {text(docsUiText.apiEndpointExamples)}
          </h2>
          <div className="space-y-5">
            {artifacts.endpointExamples.map((example) => (
              <div
                key={`${example.method}-${example.path}-${example.title}`}
                className="rounded-lg border border-slate-200 bg-white overflow-hidden"
              >
                <div className="px-4 py-4 border-b border-slate-200 bg-slate-50">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="inline-flex rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold tracking-[0.14em] text-white">
                      {example.method}
                    </span>
                    <code className="text-sm text-slate-900">{example.path}</code>
                  </div>
                  <div className="mt-3 text-base font-semibold text-slate-900">
                    {resolveLocalizedText(example.title, locale)}
                  </div>
                  {example.note && (
                    <p className="mt-2 text-sm text-slate-600">
                      {resolveLocalizedText(example.note, locale)}
                    </p>
                  )}
                </div>

                <div className="divide-y divide-slate-200">
                  {example.headers && (
                    <div className="px-4 py-4">
                      <div className="text-xs uppercase tracking-[0.14em] text-slate-500 mb-2">
                        {text(docsUiText.headers)}
                      </div>
                      <pre className="m-0 overflow-x-auto rounded-md bg-slate-950 text-slate-100 text-sm p-4 leading-6">
                        <code>{JSON.stringify(example.headers, null, 2)}</code>
                      </pre>
                    </div>
                  )}

                  {example.request !== undefined && (
                    <div className="px-4 py-4">
                      <div className="text-xs uppercase tracking-[0.14em] text-slate-500 mb-2">
                        {text(docsUiText.request)}
                      </div>
                      <pre className="m-0 overflow-x-auto rounded-md bg-slate-950 text-slate-100 text-sm p-4 leading-6">
                        <code>{JSON.stringify(example.request, null, 2)}</code>
                      </pre>
                    </div>
                  )}

                  {example.response !== undefined && (
                    <div className="px-4 py-4">
                      <div className="text-xs uppercase tracking-[0.14em] text-slate-500 mb-2">
                        {text(docsUiText.response)}
                      </div>
                      <pre className="m-0 overflow-x-auto rounded-md bg-slate-950 text-slate-100 text-sm p-4 leading-6">
                        <code>{JSON.stringify(example.response, null, 2)}</code>
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {hasImplementation && (
        <section>
          <h2
            id="implemented-in-this-repo"
            className="text-2xl font-semibold tracking-tight text-slate-900 mb-4"
          >
            {text(docsUiText.implementedInRepo)}
          </h2>
          <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <ul className="divide-y divide-slate-200">
              {artifacts.implementationRefs.map((ref) => (
                <li key={`${ref.label}-${ref.path}`} className="px-4 py-4">
                  <div className="text-sm font-semibold text-slate-900">
                    {resolveLocalizedText(ref.label, locale)}
                  </div>
                  <div className="mt-1 font-mono text-xs text-slate-600">
                    {ref.href ? (
                      <a
                        href={ref.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-700 hover:underline"
                      >
                        {ref.path}
                      </a>
                    ) : (
                      ref.path
                    )}
                  </div>
                  {ref.note && (
                    <p className="mt-2 text-sm text-slate-600">
                      {resolveLocalizedText(ref.note, locale)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
