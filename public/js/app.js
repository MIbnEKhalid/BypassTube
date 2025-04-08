document.addEventListener('DOMContentLoaded', () => {
    // Add active class to current search term in input
    const searchInput = document.querySelector('.search-input-container input');
    if (searchInput && searchInput.value.trim() !== '') {
      searchInput.classList.add('active');
    }
  
    // Add click event to video cards for better UX
    const videoCards = document.querySelectorAll('.video-card');
    videoCards.forEach(card => {
      card.addEventListener('click', (e) => {
        // If user clicked on a link, don't prevent default
        if (e.target.tagName === 'A' || e.target.closest('a')) return;
        
        const link = card.querySelector('.video-link');
        if (link) {
          window.location.href = link.href;
        }
      });
    });
  
    // Responsive video resizing
    function resizeVideos() {
      const videoWrappers = document.querySelectorAll('.video-wrapper');
      videoWrappers.forEach(wrapper => {
        const width = wrapper.offsetWidth;
        wrapper.style.height = `${width * 0.5625}px`; // 16:9 ratio
      });
    }
  
    window.addEventListener('resize', resizeVideos);
    resizeVideos();
  });