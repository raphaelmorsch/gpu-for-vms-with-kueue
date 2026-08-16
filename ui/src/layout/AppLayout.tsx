import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Content,
  Masthead,
  MastheadBrand,
  MastheadContent,
  MastheadLogo,
  MastheadMain,
  Page,
  PageSection,
  SkipToContent,
  Tab,
  Tabs,
  TabTitleIcon,
  TabTitleText,
  Toolbar,
  ToolbarContent,
  ToolbarItem
} from '@patternfly/react-core';
import CogsIcon from '@patternfly/react-icons/dist/esm/icons/cogs-icon';
import DesktopIcon from '@patternfly/react-icons/dist/esm/icons/desktop-icon';
import HomeIcon from '@patternfly/react-icons/dist/esm/icons/home-icon';
import LayerGroupIcon from '@patternfly/react-icons/dist/esm/icons/layer-group-icon';
import OptimizeIcon from '@patternfly/react-icons/dist/esm/icons/optimize-icon';
import OutlinedClockIcon from '@patternfly/react-icons/dist/esm/icons/outlined-clock-icon';
import ServerIcon from '@patternfly/react-icons/dist/esm/icons/server-icon';
import './AppLayout.css';

const MAIN_ID = 'main-content';

const NAV_ITEMS = [
  { id: 'dashboard', path: '/', label: 'Dashboard', icon: <HomeIcon /> },
  { id: 'reservations', path: '/reservations', label: 'Reservas de GPU', icon: <OutlinedClockIcon /> },
  { id: 'vms', path: '/vms', label: 'Máquinas virtuais', icon: <ServerIcon /> },
  { id: 'workloads', path: '/workloads', label: 'Workloads Kueue', icon: <DesktopIcon /> },
  { id: 'queues', path: '/queues', label: 'Queue Manager', icon: <LayerGroupIcon /> },
  { id: 'scheduler', path: '/scheduler', label: 'Scheduler Manager', icon: <OptimizeIcon /> },
  { id: 'setup', path: '/setup', label: 'Configuração', icon: <CogsIcon /> }
] as const;

const isEmbedded = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get('embed') === '1' || window.self !== window.top;
};

export const AppLayout: React.FunctionComponent = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const embedded = isEmbedded();
  const isKueueManagerEmbed =
    embedded && (location.pathname.startsWith('/queues') || location.pathname.startsWith('/scheduler'));
  const navItems = embedded
    ? NAV_ITEMS.filter((item) => item.id !== 'queues' && item.id !== 'scheduler')
    : NAV_ITEMS;
  const activeKey =
    navItems.find((item) => item.path !== '/' && location.pathname.startsWith(item.path))?.id ??
    (location.pathname === '/' ? 'dashboard' : 'dashboard');

  const masthead = (
    <Masthead>
      <MastheadMain>
        <MastheadBrand>
          <MastheadLogo>GPU VMs + Kueue</MastheadLogo>
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <Toolbar id="gpu-vm-header-toolbar">
          <ToolbarContent>
            <ToolbarItem>
              <Content component="small">Reservas de GPU e máquinas virtuais no OpenShift</Content>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </MastheadContent>
    </Masthead>
  );

  return (
    <Page
      className={embedded ? 'gpu-vm-page--embedded' : undefined}
      masthead={embedded ? undefined : masthead}
      sidebar={null}
      skipToContent={<SkipToContent href={`#${MAIN_ID}`}>Ir para o conteúdo</SkipToContent>}
      mainContainerId={MAIN_ID}
    >
      {!isKueueManagerEmbed && (
        <PageSection type="tabs" stickyOnBreakpoint={{ default: 'top' }}>
          <Tabs
            activeKey={activeKey}
            onSelect={(event, eventKey) => {
              event.preventDefault();
              const item = navItems.find((nav) => nav.id === eventKey);
              if (item) {
                navigate({ pathname: item.path, search: location.search });
              }
            }}
            aria-label="Navegação da aplicação"
            component="nav"
            usePageInsets
            isOverflowHorizontal
          >
            {navItems.map((item) => (
              <Tab
                key={item.id}
                eventKey={item.id}
                href={item.path}
                title={
                  <>
                    <TabTitleIcon>{item.icon}</TabTitleIcon>
                    <TabTitleText>{item.label}</TabTitleText>
                  </>
                }
              />
            ))}
          </Tabs>
        </PageSection>
      )}
      <Outlet />
    </Page>
  );
};
