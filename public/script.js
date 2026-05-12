
document.addEventListener('DOMContentLoaded', function() {
  // Handle row click to show/hide details
  const rows = document.querySelectorAll('.data-row');
  rows.forEach(row => {
    row.addEventListener('click', function() {
      const id = this.getAttribute('data-id');
      const detailsRow = document.getElementById('details-' + id);
      
      // Hide all other detail rows
      document.querySelectorAll('.details-row').forEach(dr => {
        if (dr.id !== 'details-' + id) {
          dr.style.display = 'none';
        }
      });
      
      // Toggle current detail row
      if (detailsRow.style.display === 'table-row') {
        detailsRow.style.display = 'none';
      } else {
        detailsRow.style.display = 'table-row';
      }
    });
  });
  
  // Handle auto-refresh
  const autoRefreshCheckbox = document.getElementById('auto-refresh');
  const refreshIntervalSelect = document.getElementById('refresh-interval');
  let refreshInterval;
  
  function startAutoRefresh() {
    const interval = parseInt(refreshIntervalSelect.value) * 1000;
    refreshInterval = setInterval(() => {
      window.location.reload();
    }, interval);
  }
  
  function stopAutoRefresh() {
    clearInterval(refreshInterval);
  }
  
  autoRefreshCheckbox.addEventListener('change', function() {
    if (this.checked) {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });
  
  refreshIntervalSelect.addEventListener('change', function() {
    if (autoRefreshCheckbox.checked) {
      stopAutoRefresh();
      startAutoRefresh();
    }
  });
  
  // Initialize auto-refresh if checked
  if (autoRefreshCheckbox.checked) {
    startAutoRefresh();
  }
});
