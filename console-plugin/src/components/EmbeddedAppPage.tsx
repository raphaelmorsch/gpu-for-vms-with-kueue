import * as React from 'react';

const APP_ROUTE_PREFIX = 'gpu-vm-console-gpu-vm-kueue';

const appUrl = (appPath: string): string => {
  const appsDomain = window.location.hostname.replace(/^[^.]+\./, '');
  const path = appPath.startsWith('/') ? appPath : `/${appPath}`;
  return `https://${APP_ROUTE_PREFIX}.${appsDomain}${path}?embed=1`;
};

export const EmbeddedAppPage: React.FC<{ appPath: string; title: string }> = ({ appPath, title }) => {
  const src = React.useMemo(() => appUrl(appPath), [appPath]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 76px)',
        minHeight: '480px',
      }}
    >
      <iframe
        src={src}
        title={title}
        style={{
          flex: 1,
          width: '100%',
          border: 0,
          background: 'var(--pf-t--global--background--color--100)',
        }}
      />
    </div>
  );
};
