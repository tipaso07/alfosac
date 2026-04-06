import { Link } from 'react-router-dom'
import '../styles/Sidebar.css'

export default function Sidebar({ activeTab, setActiveTab, visibleModules = [], tabByModuleId = {} }) {

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        {visibleModules.map((mod) => {
          const tabId = tabByModuleId[mod.id]
          const isActive = activeTab === tabId

          return (
            <Link
              key={mod.id}
              to={mod.path}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => {
                if (tabId) setActiveTab(tabId)
              }}
            >
              <span className="nav-label">{mod.name}</span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
