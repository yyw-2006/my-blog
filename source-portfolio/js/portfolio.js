(function () {
  'use strict';

  var slots = document.querySelectorAll('.portfolio-video-slot');
  slots.forEach(function (slot) {
    var placeholder = slot.querySelector('.portfolio-video-placeholder');
    if (!placeholder) return;

    placeholder.addEventListener('click', function () {
      var videoUrl = (slot.getAttribute('data-video-url') || '').trim();
      if (!videoUrl) {
        var hint = placeholder.querySelector('small');
        if (hint) hint.textContent = '请在 data-video-url 中填入嵌入地址';
        return;
      }

      var iframe = document.createElement('iframe');
      iframe.className = 'portfolio-video-iframe';
      iframe.src = videoUrl;
      iframe.title = slot.getAttribute('data-video-title') || '项目演示视频';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.allowFullscreen = true;
      slot.replaceChildren(iframe);
    });
  });
})();
