import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Masthead,
  MastheadBrand,
  MastheadContent,
  MastheadLogo,
  MastheadMain,
  MastheadToggle,
  Nav,
  NavItem,
  NavList,
  Page,
  PageSidebar,
  PageSidebarBody,
  PageToggleButton,
  SkipToContent,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  Content
} from '@patternfly/react-core';
import CogsIcon from '@patternfly/react-icons/dist/esm/icons/cogs-icon';
import DesktopIcon from '@patternfly/react-icons/dist/esm/icons/desktop-icon';
import HomeIcon from '@patternfly/react-icons/dist/esm/icons/home-icon';
import OutlinedClockIcon from '@patternfly/react-icons/dist/esm/icons/outlined-clock-icon';
import ServerIcon from '@patternfly/react-icons/dist/esm/icons/server-icon';

const MAIN_ID = 'main-content';

export const AppLayout: React.FunctionComponent = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();

  const masthead = (
    <Masthead>
      <MastheadMain>
        <MastheadToggle>
          <PageToggleButton
            isHamburgerButton
            aria-label="Navegação global"
            isSidebarOpen={isSidebarOpen}
            onSidebarToggle={() => setIsSidebarOpen((open) => !open)}
            id="gpu-vm-nav-toggle"
          />
        </MastheadToggle>
        <MastheadBrand>
          <MastheadLogo>
            GPU VMs + Kueue
          </MastheadLogo>
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

  const sidebar = (
    <PageSidebar isSidebarOpen={isSidebarOpen} id="gpu-vm-sidebar">
      <PageSidebarBody>
        <Nav aria-label="Navegação principal">
          <NavList>
            <NavItem
              itemId="dashboard"
              to="/"
              isActive={location.pathname === '/'}
              onClick={(event) => {
                event.preventDefault();
                navigate('/');
              }}
            >
              <HomeIcon /> Dashboard
            </NavItem>
            <NavItem
              itemId="reservations"
              to="/reservations"
              isActive={location.pathname === '/reservations'}
              onClick={(event) => {
                event.preventDefault();
                navigate('/reservations');
              }}
            >
              <OutlinedClockIcon /> Reservas de GPU
            </NavItem>
            <NavItem
              itemId="vms"
              to="/vms"
              isActive={location.pathname === '/vms'}
              onClick={(event) => {
                event.preventDefault();
                navigate('/vms');
              }}
            >
              <ServerIcon /> Máquinas virtuais
            </NavItem>
            <NavItem
              itemId="workloads"
              to="/workloads"
              isActive={location.pathname === '/workloads'}
              onClick={(event) => {
                event.preventDefault();
                navigate('/workloads');
              }}
            >
              <DesktopIcon /> Workloads Kueue
            </NavItem>
            <NavItem
              itemId="setup"
              to="/setup"
              isActive={location.pathname === '/setup'}
              onClick={(event) => {
                event.preventDefault();
                navigate('/setup');
              }}
            >
              <CogsIcon /> Configuração do cluster
            </NavItem>
          </NavList>
        </Nav>
      </PageSidebarBody>
    </PageSidebar>
  );

  return (
    <Page
      masthead={masthead}
      sidebar={sidebar}
      skipToContent={<SkipToContent href={`#${MAIN_ID}`}>Ir para o conteúdo</SkipToContent>}
      mainContainerId={MAIN_ID}
    >
      <Outlet />
    </Page>
  );
};
