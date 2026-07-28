import SonarImportClient from '@/components/sonar/SonarImportClient'

export const metadata = {
  title: 'Importera ekolodsdata · Fiskeloggboken',
}

export default function SonarImportPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 pb-8 pt-6">
      <div className="mb-6">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Inställningar
        </div>
        <h1 className="mt-1 text-2xl font-semibold">Importera ekolodsdata</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Importera ett helt SD-kort och bygg din privata djupkarta ovanpå
          Mapbox. Uppladdning och analys kan återupptas efter avbrott.
        </p>
      </div>
      <SonarImportClient />
    </div>
  )
}
